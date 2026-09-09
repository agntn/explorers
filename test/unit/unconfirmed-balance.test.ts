import { afterEach, describe, expect, it, vi } from "vitest";
import { create } from "../../src/core/registry.js";

const ADDRESS = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh";

const providers = [
  { provider: "mempool", chain: "bitcoin", address: ADDRESS },
  { provider: "blockstream", chain: "bitcoin", address: ADDRESS },
  { provider: "mempool", chain: "litecoin", address: "LfdYLbP9F9CpmCX6atZnHZb8KkS8T6x4DK" },
  { provider: "mempool", chain: "pepecoin", address: "Pu5spyDwNEQxmWLkUHv779AWNkpMdQ29SZ" },
] as const;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe.each(providers)("$provider $chain unconfirmed balance", ({ provider, chain, address }) => {
  it.each([
    { funded: 3000, spent: 0, expected: "3000" },
    { funded: 4000, spent: 10000, expected: "-6000" },
    { funded: 0, spent: 0, expected: "0" },
    { funded: "9007199254740993", spent: "9007199254740992", expected: "1" },
  ])(
    "reports the signed delta $expected without changing confirmed totals",
    async ({ funded, spent, expected }) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                chain_stats: { funded_txo_sum: 10000, spent_txo_sum: 2000 },
                mempool_stats: { funded_txo_sum: funded, spent_txo_sum: spent },
              }),
              { headers: { "Content-Type": "application/json" } },
            ),
        ),
      );

      const balance = await (await create(provider)).getBalance(address, chain);
      expect(balance).toMatchObject({
        balance: "8000",
        balanceFormatted: "0.00008",
        funded: "10000",
        spent: "2000",
        unconfirmed: expected,
      });
    },
  );

  it("does not invent a zero when the response omits mempool statistics", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              chain_stats: { funded_txo_sum: 10000, spent_txo_sum: 2000 },
            }),
            { headers: { "Content-Type": "application/json" } },
          ),
      ),
    );

    const balance = await (await create(provider)).getBalance(address, chain);
    expect(balance.balance).toBe("8000");
    expect(balance).not.toHaveProperty("unconfirmed");
  });
});
