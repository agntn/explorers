import { afterEach, describe, expect, it, vi } from "vitest";
import { UnsupportedChainError } from "../../src/core/errors.js";
import { create } from "../../src/core/registry.js";

const BTC_ADDRESS = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh";
const ETH_ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

function stubJSON(body: unknown) {
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("blockchair provider", () => {
  it("formats Bitcoin balances as satoshis", async () => {
    stubJSON({
      data: {
        [BTC_ADDRESS]: {
          address: { balance: 123456789 },
        },
      },
      context: { code: 200 },
    });
    const provider = await create("blockchair");

    const balance = await provider.getBalance(BTC_ADDRESS, "bitcoin");

    expect(balance).toMatchObject({
      balance: "123456789",
      balanceFormatted: "1.23456789",
      symbol: "BTC",
    });
  });

  it("maps Ethereum transaction fields without multiplying wei", async () => {
    stubJSON({
      data: {
        "0xtx": {
          transaction: {
            hash: "0xtx",
            block_id: 123,
            time: "2026-08-09 18:00:00",
            fee: "21000000000000",
            sender: ETH_ADDRESS,
            recipient: "0x0000000000000000000000000000000000000001",
            value: "1000000000000000000",
            gas_used: 21000,
            gas_price: "1000000000",
            failed: true,
            input_hex: "a9059cbb",
          },
        },
      },
      context: { code: 200 },
    });
    const provider = await create("blockchair");

    const transaction = await provider.getTxDetail("0xtx", "eth");

    expect(transaction).toMatchObject({
      from: ETH_ADDRESS,
      to: "0x0000000000000000000000000000000000000001",
      timestamp: "2026-08-09T18:00:00.000Z",
      value: "1000000000000000000",
      valueFormatted: "1",
      gasUsed: "21000",
      gasPrice: "1000000000",
      fee: "21000000000000",
      status: "failed",
      isContractInteraction: true,
    });
  });

  it("joins a custom base URL with the chain path exactly once", async () => {
    const fetch = stubJSON({
      data: { [ETH_ADDRESS]: { address: { balance: "0" } } },
      context: { code: 200 },
    });
    const provider = await create("blockchair", { baseUrl: "https://example.test/" });

    await provider.getBalance(ETH_ADDRESS, "eth");

    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      `https://example.test/ethereum/dashboards/address/${ETH_ADDRESS}`,
    );
  });

  it("rejects explorer slugs that Blockchair does not serve", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const provider = await create("blockchair");

    await expect(provider.getBalance(ETH_ADDRESS, "base")).rejects.toBeInstanceOf(
      UnsupportedChainError,
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
