/**
 * blocex — TRON (TronGrid) integration tests
 *
 * Live roundtrips against TronGrid public API.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { create } from "../../src/core/registry.js";
import "../../src/providers/tron.js";

// USDT TRC-20 contract on TRON — well-known, always has balance
const USDT_TRON = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

describe("tron provider", () => {
  let provider: ReturnType<typeof create>;

  beforeAll(() => {
    provider = create("tron");
  });

  it("reports capabilities", () => {
    const caps = provider.capabilities;
    expect(caps.balances).toBe(true);
    expect(caps.txHistory).toBe(true);
    expect(caps.blockInfo).toBe(true);
    expect(caps.txDetail).toBe(false);
    expect(caps.contractInfo).toBe(false);
    expect(caps.tokenBalances).toBe(false);
  });

  it("getBalance returns TRX balance for known address", async () => {
    const balance = await provider.getBalance(USDT_TRON, "tron");

    expect(balance.address).toBe(USDT_TRON);
    expect(balance.chain).toBe("tron");
    expect(balance.symbol).toBe("TRX");
    expect(balance.balance).toMatch(/^\d+$/);
    expect(Number(balance.balanceFormatted)).toBeGreaterThan(0);
  });

  it("getTxHistory returns TRON transactions", async () => {
    const txs = await provider.getTxHistory(USDT_TRON, "tron", { limit: 3 });

    expect(Array.isArray(txs)).toBe(true);
    expect(txs.length).toBeGreaterThan(0);
    expect(txs.length).toBeLessThanOrEqual(3);

    const tx = txs[0]!;
    expect(tx.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(tx.timestamp).toBeTruthy();
    expect(["success", "failed"]).toContain(tx.status);
  });

  it("getBalance throws for non-tron chain", async () => {
    await expect(provider.getBalance(USDT_TRON, "eth")).rejects.toThrow();
  });
});
