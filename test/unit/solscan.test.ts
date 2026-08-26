import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError } from "../../src/core/errors.js";
import { create } from "../../src/core/registry.js";

const ADDRESS = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

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

describe("solscan provider", () => {
  let provider: ReturnType<typeof create>;

  beforeEach(async () => {
    provider = await create("solscan", { apiKey: "secret", baseUrl: "https://example.test/" });
  });

  it("requires a Solscan API key", async () => {
    vi.stubEnv("SOLSCAN_API_KEY", "");
    await expect(create("solscan")).rejects.toThrow(AuthError);
  });

  it("reports only explorer-backed capabilities", () => {
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

  it("gets lamport balance through account/detail with token auth", async () => {
    const fetch = stubJSON({
      success: true,
      data: { account: ADDRESS, lamports: "1500000000" },
    });

    await expect(provider.getBalance(ADDRESS, "solana")).resolves.toMatchObject({
      address: ADDRESS,
      chain: "solana",
      balance: "1500000000",
      balanceFormatted: "1.5",
      symbol: "SOL",
    });

    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe(`https://example.test/account/detail?address=${ADDRESS}`);
    expect(new Headers(init?.headers).get("token")).toBe("secret");
  });

  it("maps indexed account transactions", async () => {
    stubJSON({
      success: true,
      data: [
        {
          slot: 42,
          fee: "5000",
          status: "Success",
          signer: ADDRESS,
          block_time: 1_700_000_000,
          tx_hash: "signature",
          program_ids: ["program"],
        },
      ],
    });

    await expect(provider.getTxHistory(ADDRESS, "solana", { limit: 3 })).resolves.toEqual([
      expect.objectContaining({
        hash: "signature",
        blockNumber: 42,
        from: ADDRESS,
        fee: "5000",
        status: "success",
        isContractInteraction: true,
      }),
    ]);
  });

  it("maps transaction and block details", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              tx_hash: "signature",
              block_id: 42,
              block_time: 1_700_000_000,
              fee: 5000,
              signer: [ADDRESS],
              status: 1,
              compute_units_consumed: 25000,
              programs_involved: ["program"],
            },
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              fee_rewards: 1000,
              transactions_count: 12,
              current_slot: 42,
              block_height: 40,
              block_time: 1_700_000_000,
              blockhash: "blockhash",
              parent_slot: 41,
            },
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetch);

    await expect(provider.getTxDetail!("signature", "solana")).resolves.toMatchObject({
      hash: "signature",
      blockNumber: 42,
      gasUsed: "25000",
      status: "success",
    });
    await expect(provider.getBlockInfo!(42, "solana")).resolves.toMatchObject({
      number: 42,
      hash: "blockhash",
      parentHash: "41",
      txCount: 12,
    });
  });

  it("rejects non-Solana chains", async () => {
    await expect(provider.getBalance(ADDRESS, "ethereum")).rejects.toThrow();
  });
});
