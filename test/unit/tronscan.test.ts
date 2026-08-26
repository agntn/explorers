import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError } from "../../src/core/errors.js";
import { create } from "../../src/core/registry.js";

const ADDRESS = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}

function stubJSON(body: unknown) {
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse(body));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("tronscan provider", () => {
  let provider: ReturnType<typeof create>;

  beforeEach(async () => {
    provider = await create("tronscan", { apiKey: "secret", baseUrl: "https://example.test/" });
  });

  it("requires a TRONSCAN API key", async () => {
    vi.stubEnv("TRONSCAN_API_KEY", "");
    await expect(create("tronscan")).rejects.toThrow(AuthError);
  });

  it("reports explorer-backed capabilities", () => {
    expect(provider.capabilities).toEqual({
      balances: true,
      txHistory: true,
      txDetail: true,
      contractInfo: false,
      tokenBalances: false,
      tokenTransfers: false,
      gasData: false,
      blockInfo: true,
    });
    expect(provider.getGasData).toBeUndefined();
  });

  it("gets account balance with TRON-PRO-API-KEY", async () => {
    const fetch = stubJSON({ address: ADDRESS, balance: 1_250_000, balanceStr: "1250000" });

    await expect(provider.getBalance(ADDRESS, "tron")).resolves.toMatchObject({
      address: ADDRESS,
      chain: "tron",
      balance: "1250000",
      balanceFormatted: "1.25",
      symbol: "TRX",
    });

    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe(`https://example.test/api/accountv2?address=${ADDRESS}`);
    expect(new Headers(init?.headers).get("TRON-PRO-API-KEY")).toBe("secret");
  });

  it("maps account transaction history", async () => {
    const fetch = stubJSON({
      data: [
        {
          hash: "a".repeat(64),
          timestamp: 1_700_000_000_000,
          block: 42,
          ownerAddress: ADDRESS,
          toAddress: "TRecipient",
          contractType: 1,
          confirmed: true,
          revert: false,
          contractRet: "SUCCESS",
          amount: "1000000",
          cost: { fee: "10" },
        },
      ],
    });

    await expect(provider.getTxHistory(ADDRESS, "tron", { limit: 3 })).resolves.toEqual([
      expect.objectContaining({
        hash: "a".repeat(64),
        blockNumber: 42,
        from: ADDRESS,
        to: "TRecipient",
        value: "1000000",
        fee: "10",
        status: "success",
      }),
    ]);
    expect(String(fetch.mock.calls[0]?.[0])).toContain("sort=-timestamp");
  });

  it("maps transaction and block details", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          hash: "a".repeat(64),
          timestamp: 1_700_000_000_000,
          block: 42,
          ownerAddress: ADDRESS,
          contractType: 31,
          revert: false,
          contractRet: "SUCCESS",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              number: 42,
              hash: "blockhash",
              timestamp: 1_700_000_000_000,
              nrOfTrx: 12,
              witnessAddress: "TWitness",
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetch);

    await expect(provider.getTxDetail!("a".repeat(64), "tron")).resolves.toMatchObject({
      hash: "a".repeat(64),
      blockNumber: 42,
      status: "success",
      isContractInteraction: true,
    });
    await expect(provider.getBlockInfo!(42, "tron")).resolves.toMatchObject({
      number: 42,
      hash: "blockhash",
      miner: "TWitness",
      txCount: 12,
    });
  });

  it("rejects non-TRON chains", async () => {
    await expect(provider.getBalance(ADDRESS, "eth")).rejects.toThrow();
  });
});
