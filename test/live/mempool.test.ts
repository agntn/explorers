/** Live mempool.space, litecoinspace.org and peppool.space roundtrips. Run with `pnpm test:live`. */
import { beforeAll, describe, expect, it } from "vitest";
import type { Provider } from "../../src/core/provider.js";
import { create } from "../../src/core/registry.js";

const KNOWN_BTC = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh";
const KNOWN_LTC = "LfdYLbP9F9CpmCX6atZnHZb8KkS8T6x4DK";
const KNOWN_PEP = "Pu5spyDwNEQxmWLkUHv779AWNkpMdQ29SZ";
const GENESIS_PUZZLE_TX = "b691de3657880d9a1eabd2783b1a9fa8c5313ced338495bf10e85727012d7a77";

describe("mempool provider, live", () => {
  let provider: Provider;

  beforeAll(async () => {
    provider = await create("mempool");
  });

  it("reads a Bitcoin balance from mempool.space", async () => {
    const balance = await provider.getBalance(KNOWN_BTC, "bitcoin");

    expect(balance.address).toBe(KNOWN_BTC);
    expect(balance.chain).toBe("bitcoin");
    expect(balance.symbol).toBe("BTC");
    expect(balance.balance).toMatch(/^-?\d+$/);
    expect(Number(balance.balanceFormatted)).toBeGreaterThan(0);
  });

  it("reads a Litecoin balance from litecoinspace.org", async () => {
    const balance = await provider.getBalance(KNOWN_LTC, "litecoin");

    expect(balance.address).toBe(KNOWN_LTC);
    expect(balance.chain).toBe("litecoin");
    expect(balance.symbol).toBe("LTC");
    expect(balance.balance).toMatch(/^-?\d+$/);
    expect(Number(balance.balanceFormatted)).toBeGreaterThan(0);
  });

  it("reads a Pepecoin balance from peppool.space", async () => {
    const balance = await provider.getBalance(KNOWN_PEP, "pepecoin");

    expect(balance.address).toBe(KNOWN_PEP);
    expect(balance.chain).toBe("pepecoin");
    expect(balance.symbol).toBe("PEP");
    expect(balance.balance).toMatch(/^-?\d+$/);
  });

  it("returns Bitcoin history for a known address", async () => {
    const transactions = await provider.getTxHistory(KNOWN_BTC, "bitcoin", { limit: 3 });

    expect(transactions.length).toBeGreaterThan(0);
    expect(transactions.length).toBeLessThanOrEqual(3);
    expect(transactions[0]?.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(transactions[0]?.status).toBe("success");
    expect(transactions[0]?.blockNumber).toBeGreaterThan(0);
  });

  it("reads an OP_RETURN message of 252 bytes", async () => {
    const tx = await provider.getTxDetail!(GENESIS_PUZZLE_TX, "bitcoin");

    expect(tx.opReturn?.[0]?.text).toContain(
      "I made a Bitcoin puzzle using information contained in the genesis block",
    );
  });

  it("returns Bitcoin fee estimates", async () => {
    const gas = await provider.getGasData!("bitcoin");

    expect(gas.chain).toBe("bitcoin");
    expect(gas.unit).toBe("sat/vB");
    expect(gas.proposedGasPrice).toBeTruthy();
    expect(Number(gas.proposedGasPrice)).toBeGreaterThan(0);
  });
});
