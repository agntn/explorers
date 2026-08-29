import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError } from "../../src/core/errors.js";
import { create } from "../../src/core/registry.js";

const ADDRESS = "0x61953ea72709eed72f4441dd944eec49a11b4acabfc8e04015e89c63be81b6ab";

function stubJSON(body: unknown) {
  const fetch = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("blockberry provider", () => {
  let provider: Awaited<ReturnType<typeof create>>;

  beforeEach(async () => {
    provider = await create("blockberry", { apiKey: "secret", baseUrl: "https://example.test/" });
  });

  it("requires a Blockberry API key", async () => {
    vi.stubEnv("BLOCKBERRY_API_KEY", "");
    await expect(create("blockberry")).rejects.toThrow(AuthError);
  });

  it("reports only operations exposed by the explorer API", () => {
    expect(provider.capabilities).toEqual({
      balances: true,
      txHistory: true,
      txDetail: false,
      contractInfo: false,
      tokenBalances: false,
      tokenTransfers: false,
      gasData: false,
      blockInfo: false,
    });
    expect(provider.getTxDetail).toBeUndefined();
    expect(provider.getGasData).toBeUndefined();
    expect(provider.getBlockInfo).toBeUndefined();
  });

  it("gets native SUI balance with x-api-key authentication", async () => {
    const fetch = stubJSON([
      {
        coinType: "0x2::sui::SUI",
        coinSymbol: "SUI",
        balance: "2500000000",
        decimals: 9,
      },
    ]);

    await expect(provider.getBalance(ADDRESS, "sui")).resolves.toMatchObject({
      address: ADDRESS,
      chain: "sui",
      balance: "2500000000",
      balanceFormatted: "2.5",
      symbol: "SUI",
    });

    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe(`https://example.test/v1/accounts/${ADDRESS}/balance`);
    expect(new Headers(init?.headers).get("x-api-key")).toBe("secret");
  });

  it("maps indexed account activity and query options", async () => {
    const fetch = stubJSON({
      content: [
        {
          activityType: ["TRANSFER"],
          activityWith: [{ objectType: "ACCOUNT", id: "0xsender" }],
          timestamp: 1_700_000_000_000,
          digest: "digest",
          txStatus: "SUCCESS",
          gasFee: "123",
        },
      ],
      nextCursor: "cursor",
    });

    await expect(provider.getTxHistory(ADDRESS, "sui", { limit: 3, sort: "asc" })).resolves.toEqual(
      [
        expect.objectContaining({
          hash: "digest",
          from: "0xsender",
          fee: "123",
          status: "success",
          isContractInteraction: false,
        }),
      ],
    );

    const [url] = fetch.mock.calls[0]!;
    expect(String(url)).toContain("actionType=ALL");
    expect(String(url)).toContain("size=3");
    expect(String(url)).toContain("orderBy=ASC");
  });

  it("keeps the default history limit to one activity page", async () => {
    const fetch = stubJSON({
      content: Array.from({ length: 50 }, (_, index) => ({
        activityType: ["TRANSFER"],
        timestamp: 1_700_000_000_000 + index,
        digest: `digest-${index}`,
        txStatus: "SUCCESS",
        gasFee: "1",
      })),
      nextCursor: "next-50",
    });

    await expect(provider.getTxHistory(ADDRESS, "sui")).resolves.toHaveLength(50);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("follows the activity cursor to return the requested history limit", async () => {
    const activity = (index: number) => ({
      activityType: ["TRANSFER"],
      timestamp: 1_700_000_000_000 + index,
      digest: `digest-${index}`,
      txStatus: "SUCCESS",
      gasFee: "1",
    });
    const page = (start: number, length: number, nextCursor?: string) =>
      new Response(
        JSON.stringify({
          content: Array.from({ length }, (_, index) => activity(index + start)),
          nextCursor,
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(page(0, 50, "next-50"))
      .mockResolvedValueOnce(page(50, 25));
    vi.stubGlobal("fetch", fetch);

    const transactions = await provider.getTxHistory(ADDRESS, "sui", { limit: 75 });

    expect(transactions).toHaveLength(75);
    expect(transactions.at(-1)?.hash).toBe("digest-74");
    expect(fetch).toHaveBeenCalledTimes(2);
    const secondUrl = String(fetch.mock.calls[1]?.[0]);
    expect(secondUrl).toContain("nextCursor=next-50");
    expect(secondUrl).toContain("size=25");
  });

  it("returns zero when the explorer has no native SUI row", async () => {
    stubJSON([]);
    await expect(provider.getBalance(ADDRESS, "sui")).resolves.toMatchObject({
      balance: "0",
      balanceFormatted: "0",
    });
  });

  it("rejects non-Sui chains", async () => {
    await expect(provider.getBalance(ADDRESS, "ethereum")).rejects.toThrow();
  });
});
