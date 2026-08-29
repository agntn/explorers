import { afterEach, describe, expect, it, vi } from "vitest";
import { create } from "../../src/core/registry.js";

const ADDRESS = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh";
const TXID = "a".repeat(64);
const BLOCK_HASH = "b".repeat(64);

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });
}

describe("blockstream provider", () => {
  it("reports only the operations Blockstream serves through this contract", async () => {
    const provider = await create("blockstream");

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

  it("reads exact confirmed balance totals from Blockstream", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({
        chain_stats: {
          funded_txo_count: 2,
          funded_txo_sum: "9007199254740993",
          spent_txo_count: 1,
          spent_txo_sum: "1",
          tx_count: 2,
        },
        mempool_stats: {
          funded_txo_count: 0,
          funded_txo_sum: 0,
          spent_txo_count: 0,
          spent_txo_sum: 0,
          tx_count: 0,
        },
      }),
    );
    vi.stubGlobal("fetch", fetch);

    const provider = await create("blockstream");
    const balance = await provider.getBalance(ADDRESS, "bitcoin");

    expect(balance).toMatchObject({
      address: ADDRESS,
      chain: "bitcoin",
      balance: "9007199254740992",
      balanceFormatted: "90071992.54740992",
      funded: "9007199254740993",
      spent: "1",
      symbol: "BTC",
      blockNumber: null,
      blockHash: null,
    });
    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      `https://blockstream.info/api/address/${ADDRESS}`,
    );
  });

  it("maps address history and respects the requested limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse([
          {
            txid: TXID,
            vin: [{ prevout: { scriptpubkey_address: ADDRESS, value: 100_000 } }],
            vout: [
              { scriptpubkey_address: "bc1qrecipient", value: 70_000 },
              { scriptpubkey_address: ADDRESS, value: 29_000 },
            ],
            fee: 1_000,
            status: { confirmed: true, block_height: 900_000, block_time: 1_749_188_499 },
          },
          {
            txid: "c".repeat(64),
            vin: [],
            vout: [],
            fee: 0,
            status: { confirmed: false },
          },
        ]),
      ),
    );

    const provider = await create("blockstream");
    const transactions = await provider.getTxHistory(ADDRESS, "bitcoin", { limit: 1 });

    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({
      hash: TXID,
      blockNumber: 900_000,
      from: ADDRESS,
      to: "bc1qrecipient",
      value: "70000",
      valueFormatted: "0.0007",
      fee: "1000",
      status: "success",
    });
  });

  it("reads one transaction by hash", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({
        txid: TXID,
        vin: [{ prevout: null }],
        vout: [{ value: 5_000_000_000 }],
        fee: 0,
        status: { confirmed: true, block_height: 0, block_time: 1_231_006_505 },
      }),
    );
    vi.stubGlobal("fetch", fetch);

    const provider = await create("blockstream");
    const transaction = await provider.getTxDetail!(TXID, "bitcoin");

    expect(transaction).toMatchObject({
      hash: TXID,
      blockNumber: 0,
      from: "unknown",
      to: null,
      value: "5000000000",
      valueFormatted: "50",
      fee: "0",
      status: "success",
    });
    expect(String(fetch.mock.calls[0]?.[0])).toBe(`https://blockstream.info/api/tx/${TXID}`);
  });

  it("reads the requested block from Blockstream's height page", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse([
        {
          id: BLOCK_HASH,
          height: 900_000,
          timestamp: 1_749_188_499,
          tx_count: 1_562,
          size: 1_920_777,
          weight: 3_130_335,
          previousblockhash: "d".repeat(64),
        },
        {
          id: "e".repeat(64),
          height: 899_999,
          timestamp: 1_749_188_000,
          tx_count: 1,
          size: 1,
          weight: 4,
          previousblockhash: "f".repeat(64),
        },
      ]),
    );
    vi.stubGlobal("fetch", fetch);

    const provider = await create("blockstream");
    const block = await provider.getBlockInfo!(900_000, "bitcoin");

    expect(block).toEqual({
      number: 900_000,
      hash: BLOCK_HASH,
      parentHash: "d".repeat(64),
      timestamp: "2025-06-06T05:41:39.000Z",
      miner: "",
      gasUsed: "1920777",
      gasLimit: "3130335",
      txCount: 1_562,
    });
    expect(fetch.mock.calls.map(([input]) => String(input))).toEqual([
      "https://blockstream.info/api/blocks/900000",
    ]);
  });

  it("rejects non-Bitcoin chains before network I/O", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const provider = await create("blockstream");

    await expect(provider.getBalance(ADDRESS, "litecoin")).rejects.toMatchObject({
      message: 'Chain "litecoin" not supported by blockstream',
      provider: "blockstream",
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
