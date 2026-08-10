/**
 * blocex — Aptos integration tests
 *
 * Live roundtrips against Aptos Labs public API.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { create } from "../../src/core/registry.js";
import "../../src/providers/aptos.js";

// Aptos framework address — always has APT balance
const APTOS_FRAMEWORK = "0x1";

function stubJSON(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } }),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("aptos provider", () => {
  let provider: ReturnType<typeof create>;

  beforeAll(() => {
    provider = create("aptos");
  });

  it("reports capabilities", () => {
    const caps = provider.capabilities;
    expect(caps.balances).toBe(true);
    expect(caps.txHistory).toBe(true);
    expect(caps.txDetail).toBe(true);
    expect(caps.blockInfo).toBe(true);
    expect(caps.contractInfo).toBe(false);
    expect(caps.tokenBalances).toBe(false);
  });

  it("getBalance returns APT balance for framework address", async () => {
    const balance = await provider.getBalance(APTOS_FRAMEWORK, "aptos");

    expect(balance.address).toBe(APTOS_FRAMEWORK);
    expect(balance.chain).toBe("aptos");
    expect(balance.symbol).toBe("APT");
    expect(balance.balance).toMatch(/^\d+$/);
    expect(Number(balance.balanceFormatted)).toBeGreaterThan(0);
  });

  it("getTxHistory returns Aptos transactions", async () => {
    const txs = await provider.getTxHistory(APTOS_FRAMEWORK, "aptos", { limit: 3 });

    expect(Array.isArray(txs)).toBe(true);
    // 0x1 might have very old txs or none in recent range
    if (txs.length > 0) {
      const tx = txs[0]!;
      expect(tx.hash).toMatch(/^0x[0-9a-f]+$/);
      expect(tx.timestamp).toBeTruthy();
      expect(["success", "failed"]).toContain(tx.status);
    }
  });

  it("does not present arbitrary entry-function arguments as an APT transfer", async () => {
    stubJSON({
      type: "user_transaction",
      version: "1",
      hash: "0xabc",
      gas_used: "2",
      success: true,
      sender: "0x1",
      gas_unit_price: "3",
      payload: {
        type: "entry_function_payload",
        function: "0x1::example::mint",
        type_arguments: [],
        arguments: ["0x2", "100"],
      },
      timestamp: "1000000",
      events: [],
    });

    const transaction = await provider.getTxDetail!("0xabc", "aptos");

    expect(transaction).toMatchObject({
      to: null,
      value: "0",
      fee: "6",
      isContractInteraction: true,
    });
  });

  it("derives block transaction count from the version range", async () => {
    stubJSON({
      block_height: "7",
      block_hash: "0xblock",
      block_timestamp: "1000000",
      first_version: "100",
      last_version: "104",
    });

    await expect(provider.getBlockInfo!(7, "aptos")).resolves.toMatchObject({
      number: 7,
      txCount: 5,
    });
  });

  it("getBalance throws for non-aptos chain", async () => {
    await expect(provider.getBalance(APTOS_FRAMEWORK, "eth")).rejects.toThrow();
  });
});
