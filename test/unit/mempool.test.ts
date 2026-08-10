/**
 * Explorers — Mempool.space integration tests (Bitcoin)
 *
 * Live roundtrips against public mempool.space API.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { create } from "../../src/core/registry.js";
import "../../src/providers/mempool.js";

// A known Bitcoin address with history
const KNOWN_BTC = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("mempool provider", () => {
  let provider: ReturnType<typeof create>;

  beforeAll(() => {
    provider = create("mempool");
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

  it("getBalance returns BTC balance for known address", async () => {
    const balance = await provider.getBalance(KNOWN_BTC, "bitcoin");

    expect(balance.address).toBe(KNOWN_BTC);
    expect(balance.chain).toBe("bitcoin");
    expect(balance.symbol).toBe("BTC");
    expect(balance.balance).toMatch(/^-?\d+$/);
    expect(Number(balance.balanceFormatted)).toBeGreaterThan(0);
  });

  it("joins custom base URLs with exactly one separator", async () => {
    const fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          chain_stats: {
            funded_txo_count: 1,
            funded_txo_sum: 10,
            spent_txo_count: 0,
            spent_txo_sum: 0,
          },
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetch);

    const customProvider = create("mempool", { baseUrl: "https://example.test/" });
    await customProvider.getBalance(KNOWN_BTC, "bitcoin");

    expect(String(fetch.mock.calls[0]?.[0])).toBe(`https://example.test/api/address/${KNOWN_BTC}`);
  });

  it("separates a sent value from its transaction fee", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([
              {
                txid: "a".repeat(64),
                vin: [{ prevout: { scriptpubkey_address: KNOWN_BTC, value: 100_000 } }],
                vout: [
                  { scriptpubkey_address: "bc1qrecipient", value: 70_000 },
                  { scriptpubkey_address: KNOWN_BTC, value: 29_000 },
                ],
                fee: 1_000,
                status: { confirmed: true, block_height: 1, block_time: 1 },
              },
            ]),
            { headers: { "Content-Type": "application/json" } },
          ),
      ),
    );

    const [transaction] = await provider.getTxHistory(KNOWN_BTC, "bitcoin", { limit: 1 });

    expect(transaction).toMatchObject({
      value: "70000",
      valueFormatted: "0.0007",
      fee: "1000",
    });
  });

  it("handles coinbase transactions with a null prevout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              txid: "4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b",
              vin: [{ prevout: null }],
              vout: [{ value: 5_000_000_000 }],
              fee: 0,
              status: { confirmed: true, block_height: 0, block_time: 1_231_006_505 },
            }),
            { headers: { "Content-Type": "application/json" } },
          ),
      ),
    );

    const transaction = await provider.getTxDetail!(
      "4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b",
      "bitcoin",
    );

    expect(transaction).toMatchObject({
      from: "unknown",
      to: null,
      value: "5000000000",
      valueFormatted: "50",
      fee: "0",
      status: "success",
    });
  });

  it("getTxHistory returns BTC transactions", async () => {
    const txs = await provider.getTxHistory(KNOWN_BTC, "bitcoin", { limit: 3 });

    expect(Array.isArray(txs)).toBe(true);
    expect(txs.length).toBeGreaterThan(0);
    expect(txs.length).toBeLessThanOrEqual(3);

    const tx = txs[0]!;
    expect(tx.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(tx.status).toBe("success");
    expect(tx.blockNumber).toBeGreaterThan(0);
  });

  it("getGasData returns fee estimates", async () => {
    const gas = await provider.getGasData!("bitcoin");

    expect(gas.chain).toBe("bitcoin");
    expect(gas.unit).toBe("sat/vB");
    expect(gas.proposedGasPrice).toBeTruthy();
    expect(Number(gas.proposedGasPrice)).toBeGreaterThan(0);
  });

  it("getBalance throws for non-bitcoin chain", async () => {
    await expect(provider.getBalance(KNOWN_BTC, "eth")).rejects.toThrow();
  });
});
