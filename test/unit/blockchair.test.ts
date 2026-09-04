import { afterEach, describe, expect, it, vi } from "vitest";
import { NotFoundError, UnsupportedChainError } from "../../src/core/errors.js";
import { create } from "../../src/core/registry.js";
import { Blockchair } from "../../src/providers/blockchair.js";

const BTC_ADDRESS = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh";
const ETH_ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const XEC_ADDRESS = "ecash:prfhcnyqnl5cgrnmlfmms675w93ld7mvvqd0y8lz07";

function stubJSON(body: unknown) {
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () =>
      new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("blockchair provider", () => {
  it("keeps the Blockchair tip with a dated Bitcoin balance", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-08-28T12:34:56.789Z");
    stubJSON({
      data: {
        [BTC_ADDRESS]: {
          address: { balance: 123456789, received: "223456789", spent: 100000000 },
        },
      },
      context: { code: 200, state: 912345 },
    });
    const provider = await create("blockchair");

    const balance = await provider.getBalance(BTC_ADDRESS, "bitcoin");

    expect(balance).toMatchObject({
      balance: "123456789",
      balanceFormatted: "1.23456789",
      symbol: "BTC",
      funded: "223456789",
      spent: "100000000",
      fetchedAt: "2026-08-28T12:34:56.789Z",
      blockNumber: 912345,
      blockHash: null,
    });
  });

  it("formats eCash balances at two decimals", async () => {
    const fetch = stubJSON({
      data: {
        [XEC_ADDRESS]: {
          address: { balance: 123456789, received: 223456789, spent: 100000000 },
        },
      },
      context: { code: 200 },
    });
    const provider = await create("blockchair");

    const balance = await provider.getBalance(XEC_ADDRESS, "ecash");

    expect(balance).toMatchObject({
      balance: "123456789",
      balanceFormatted: "1234567.89",
      symbol: "XEC",
      funded: "223456789",
      spent: "100000000",
    });
    expect(String(fetch.mock.calls[0]?.[0])).toContain("/ecash/dashboards/address/");
  });

  it("does not label account balances as UTXO funding", async () => {
    stubJSON({
      data: {
        [ETH_ADDRESS]: {
          address: { balance: "1", received: "2", spent: "1" },
        },
      },
      context: { code: 200 },
    });
    const provider = await create("blockchair");

    const balance = await provider.getBalance(ETH_ADDRESS, "ethereum");

    expect(balance).not.toHaveProperty("funded");
    expect(balance).not.toHaveProperty("spent");
  });

  it("maps eCash transactions through the UTXO shape", async () => {
    stubJSON({
      data: {
        tx: {
          transaction: {
            hash: "ab".repeat(32),
            block_id: 800000,
            time: "2026-08-26 12:00:00",
            output_total: 5000,
            fee: 219,
          },
        },
      },
      context: { code: 200 },
    });
    const provider = await create("blockchair");

    const transaction = await provider.getTxDetail("ab".repeat(32), "ecash");

    expect(transaction).toMatchObject({
      value: "5000",
      valueFormatted: "50",
      fee: "219",
      status: "success",
      isContractInteraction: false,
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

    const transaction = await provider.getTxDetail("0xtx", "ethereum");

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

  it.each(["bitcoin", "ecash"] as const)(
    "reads the genesis block on %s by height",
    async (chain) => {
      const hash = "000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f";
      const fetch = stubJSON({
        data: {
          "0": {
            block: { id: 0, hash, time: "2009-01-03 18:15:05", transaction_count: 1 },
            transactions: [],
          },
        },
        context: { code: 200 },
      });
      const provider = new Blockchair({});

      expect(await provider.getBlockInfo(0, chain)).toEqual({
        number: 0,
        hash,
        parentHash: "",
        timestamp: "2009-01-03T18:15:05.000Z",
        miner: "",
        gasUsed: "0",
        gasLimit: "0",
        txCount: 1,
        baseFee: undefined,
      });
      expect(String(fetch.mock.calls[0]?.[0])).toContain(`/${chain}/dashboards/blocks/0`);
    },
  );

  it("maps Ethereum block fields without counting the paginated transaction list", async () => {
    const hash = "0xda214d1b1d458e7ae0e626b69a52a59d19762c51a53ff64813c4d31256282fdf";
    stubJSON({
      data: {
        "2345678": {
          block: {
            id: 2345678,
            hash,
            time: "2016-09-29 01:39:41",
            miner: "0x4bb96091ee9d802ed039c4d1a5f6216f90f81b01",
            gas_used: 105000,
            gas_limit: 1500000,
            transaction_count: 5,
          },
          transactions: [],
        },
      },
      context: { code: 200 },
    });
    const provider = new Blockchair({});

    expect(await provider.getBlockInfo(2345678, "ethereum")).toEqual({
      number: 2345678,
      hash,
      parentHash: "",
      timestamp: "2016-09-29T01:39:41.000Z",
      miner: "0x4bb96091ee9d802ed039c4d1a5f6216f90f81b01",
      gasUsed: "105000",
      gasLimit: "1500000",
      txCount: 5,
      baseFee: undefined,
    });
  });

  it("reports a missing block as not found", async () => {
    stubJSON({ data: {}, context: { code: 200, results: 0 } });
    const provider = new Blockchair({});

    await expect(provider.getBlockInfo(9999999, "ecash")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("joins a custom base URL with the chain path exactly once", async () => {
    const fetch = stubJSON({
      data: { [ETH_ADDRESS]: { address: { balance: "0" } } },
      context: { code: 200 },
    });
    const provider = await create("blockchair", { baseUrl: "https://example.test/" });

    await provider.getBalance(ETH_ADDRESS, "ethereum");

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
