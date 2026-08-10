/**
 * blocex — Sui integration tests
 *
 * Live roundtrips against Sui public GraphQL RPC.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { create, getDefaultURL } from "../../src/core/registry.js";
import "../../src/providers/sui.js";

// Sui system address — always has SUI balance
const SUI_SYSTEM = "0x0000000000000000000000000000000000000000000000000000000000000002";
const KNOWN_SENDER = "0xb9345655b74757bfd532d52e368ad0f670fbe2854560bf6e3e98ec749088e786";
const KNOWN_TX = "CFrEcHG1K3KQfjTRgQSfquhdsEJ3Eh8fmne3CETY876V";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sui provider", () => {
  let provider: ReturnType<typeof create>;

  beforeAll(() => {
    provider = create("sui");
  });

  it("reports capabilities", () => {
    const caps = provider.capabilities;
    expect(caps.balances).toBe(true);
    expect(caps.txHistory).toBe(true);
    expect(caps.txDetail).toBe(true);
    expect(caps.gasData).toBe(true);
    expect(caps.blockInfo).toBe(true);
    expect(caps.contractInfo).toBe(false);
    expect(caps.tokenBalances).toBe(false);
  });

  it("advertises the GraphQL endpoint", () => {
    expect(getDefaultURL("sui")).toBe("https://graphql.mainnet.sui.io/graphql");
  });

  it("getBalance returns SUI balance for system address", async () => {
    const balance = await provider.getBalance(SUI_SYSTEM, "sui");

    expect(balance.address).toBe(SUI_SYSTEM);
    expect(balance.chain).toBe("sui");
    expect(balance.symbol).toBe("SUI");
    expect(balance.balance).toMatch(/^\d+$/);
    expect(Number(balance.balanceFormatted)).toBeGreaterThan(0);
  });

  it("getTxHistory returns transactions affecting an address", async () => {
    const transactions = await provider.getTxHistory(KNOWN_SENDER, "sui");

    expect(transactions.length).toBeGreaterThan(0);
    expect(transactions.length).toBeLessThanOrEqual(50);
    expect(transactions[0]?.hash).toBeTruthy();
  });

  it("queries newest affected transactions", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: { address: { transactions: { nodes: [] } } } }), {
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetch);

    await provider.getTxHistory(KNOWN_SENDER, "sui", { limit: 3 });
    const requestBody = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as {
      query: string;
      variables: { limit: number };
    };

    expect(requestBody.query).toContain("transactions(last: $limit, relation: AFFECTED)");
    expect(requestBody.variables.limit).toBe(3);
  });

  it("getTxDetail returns a known transaction", async () => {
    const transaction = await provider.getTxDetail(KNOWN_TX, "sui");

    expect(transaction.hash).toBe(KNOWN_TX);
    expect(transaction.from).toBe(KNOWN_SENDER);
    expect(transaction.status).toBe("success");
    expect(transaction.blockNumber).toBeGreaterThan(0);
  });

  it("subtracts the storage rebate from the transaction fee", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              transaction: {
                digest: "digest",
                effects: {
                  status: "SUCCESS",
                  gasEffects: {
                    gasSummary: {
                      computationCost: "10",
                      storageCost: "5",
                      storageRebate: "3",
                    },
                  },
                },
              },
            },
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetch);

    const transaction = await provider.getTxDetail("digest", "sui");
    const requestBody = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as {
      query: string;
    };

    expect(requestBody.query).toContain("storageRebate");
    expect(transaction.fee).toBe("12");
  });

  it("getGasData returns reference gas price", async () => {
    const gas = await provider.getGasData!("sui");

    expect(gas.chain).toBe("sui");
    expect(gas.unit).toBe("MIST");
    expect(gas.proposedGasPrice).toBeTruthy();
    expect(Number(gas.proposedGasPrice)).toBeGreaterThan(0);
  });

  it("getBlockInfo returns checkpoint data", async () => {
    const block = await provider.getBlockInfo!(1000000, "sui");

    expect(block.number).toBe(1000000);
    expect(block.hash).toBeTruthy();
    expect(block.timestamp).toBeTruthy();
    expect(block.txCount).toBeGreaterThanOrEqual(0);
  });

  it("getBalance throws for non-sui chain", async () => {
    await expect(provider.getBalance(SUI_SYSTEM, "eth")).rejects.toThrow();
  });
});
