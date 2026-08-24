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

/** Serve one canned transaction whose outputs are the interesting part. */
function stubTxDetail(
  vout: Array<{ scriptpubkey?: string; scriptpubkey_address?: string; value: number }>,
): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            txid: "a".repeat(64),
            vin: [{ prevout: { scriptpubkey_address: KNOWN_BTC, value: 3_000 } }],
            vout,
            fee: 500,
            status: { confirmed: true, block_height: 963_629, block_time: 1_787_427_938 },
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
    ),
  );
}

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

  it("reads the message an OP_RETURN output carries", async () => {
    stubTxDetail([
      { scriptpubkey: "0014c30f5f3fccac11feca2fd0322b607c9d73995fde", value: 2_000 },
      {
        scriptpubkey:
          "6a31426f7468206b65797320617265206465726976656420696e646570656e64656e746c792066726f6d2047656e657369732e",
        value: 0,
      },
    ]);

    const tx = await provider.getTxDetail!("a".repeat(64), "bitcoin");

    expect(tx.opReturn).toEqual([
      {
        hex: "426f7468206b65797320617265206465726976656420696e646570656e64656e746c792066726f6d2047656e657369732e",
        text: "Both keys are derived independently from Genesis.",
      },
    ]);
  });

  it("strips the push prefix from an OP_PUSHDATA1 payload", async () => {
    stubTxDetail([{ scriptpubkey: "6a4c0b48656c6c6f2c2042544321", value: 0 }]);

    const tx = await provider.getTxDetail!("a".repeat(64), "bitcoin");

    expect(tx.opReturn).toEqual([{ hex: "48656c6c6f2c2042544321", text: "Hello, BTC!" }]);
  });

  it("keeps every push of a multi-push OP_RETURN separate", async () => {
    stubTxDetail([{ scriptpubkey: "6a0548656c6c6f024f6b", value: 0 }]);

    const tx = await provider.getTxDetail!("a".repeat(64), "bitcoin");

    expect(tx.opReturn).toEqual([
      { hex: "48656c6c6f", text: "Hello" },
      { hex: "4f6b", text: "Ok" },
    ]);
  });

  it("reads the wider push opcodes and skips a truncated one", async () => {
    stubTxDetail([
      { scriptpubkey: "6a4d050048656c6c6f", value: 0 },
      { scriptpubkey: "6a4e0500000048656c6c6f", value: 0 },
      { scriptpubkey: "6a2048656c6c6f", value: 0 },
    ]);

    const tx = await provider.getTxDetail!("a".repeat(64), "bitcoin");

    expect(tx.opReturn).toEqual([
      { hex: "48656c6c6f", text: "Hello" },
      { hex: "48656c6c6f", text: "Hello" },
    ]);
  });

  it("leaves payloads without a text reading when the bytes are not printable", async () => {
    stubTxDetail([
      { scriptpubkey: "6a04ff00ff00", value: 0 },
      { scriptpubkey: "6a0361006b", value: 0 },
    ]);

    const tx = await provider.getTxDetail!("a".repeat(64), "bitcoin");

    expect(tx.opReturn).toEqual([{ hex: "ff00ff00" }, { hex: "61006b" }]);
  });

  it("refuses a text reading for payloads carrying terminal controls", async () => {
    stubTxDetail([
      { scriptpubkey: "6a0568c29b6d21", value: 0 },
      { scriptpubkey: "6a03610d62", value: 0 },
    ]);

    const tx = await provider.getTxDetail!("a".repeat(64), "bitcoin");

    expect(tx.opReturn).toEqual([{ hex: "68c29b6d21" }, { hex: "610d62" }]);
  });

  it("omits opReturn for a transaction without one", async () => {
    stubTxDetail([{ scriptpubkey: "0014c30f5f3fccac11feca2fd0322b607c9d73995fde", value: 2_000 }]);

    const tx = await provider.getTxDetail!("a".repeat(64), "bitcoin");

    expect(tx.opReturn).toBeUndefined();
  });

  it("reads OP_RETURN messages from transaction history too", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([
              {
                txid: "b".repeat(64),
                vin: [{ prevout: { scriptpubkey_address: KNOWN_BTC, value: 5_000 } }],
                vout: [
                  { scriptpubkey: "6a0548656c6c6f", value: 0 },
                  { scriptpubkey_address: KNOWN_BTC, value: 4_000 },
                ],
                fee: 1_000,
                status: { confirmed: true, block_height: 963_837, block_time: 1_787_000_000 },
              },
            ]),
            { headers: { "Content-Type": "application/json" } },
          ),
      ),
    );

    const [transaction] = await provider.getTxHistory(KNOWN_BTC, "bitcoin", { limit: 1 });

    expect(transaction?.opReturn).toEqual([{ hex: "48656c6c6f", text: "Hello" }]);
  });

  it("reads a live 252-byte OP_RETURN message", async () => {
    const tx = await provider.getTxDetail!(
      "b691de3657880d9a1eabd2783b1a9fa8c5313ced338495bf10e85727012d7a77",
      "bitcoin",
    );

    expect(tx.opReturn?.[0]?.text).toContain(
      "I made a Bitcoin puzzle using information contained in the genesis block",
    );
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
