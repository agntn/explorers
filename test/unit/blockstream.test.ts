import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { create } from "../../src/core/registry.ts";
import { FIRST_INSCRIPTION } from "./inscription-witnesses.ts";

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

function historyTransaction(index: number) {
  return {
    txid: index.toString(16).padStart(64, "0"),
    vin: [],
    vout: [],
    fee: 0,
    status: { confirmed: true, block_height: 900_000 - index, block_time: 1_749_188_499 },
  };
}

describe("blockstream provider", () => {
  it("reports only the operations Blockstream serves through this contract", async () => {
    const provider = await create("blockstream");

    expect(provider.capabilities).toEqual({
      balances: true,
      txHistory: true,
      txDetail: true,
      utxos: true,
      pubkeys: true,
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

  it("skips OP_RETURN when mapping address history", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse([
          {
            txid: TXID,
            vin: [{ prevout: { scriptpubkey_address: ADDRESS, value: 100_000 } }],
            vout: [
              { scriptpubkey_type: "op_return", value: 0 },
              {
                scriptpubkey_address: "bc1qrecipient",
                scriptpubkey_type: "v0_p2wpkh",
                value: 70_000,
              },
              { scriptpubkey_address: ADDRESS, scriptpubkey_type: "v0_p2wpkh", value: 29_000 },
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

  it("continues confirmed history until the requested limit", async () => {
    const firstPage = Array.from({ length: 25 }, (_, index) => historyTransaction(index));
    const secondPage = Array.from({ length: 25 }, (_, index) => historyTransaction(index + 25));
    const cursor = firstPage.at(-1)!.txid;
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/txs")) return jsonResponse(firstPage);
      if (url.endsWith(`/txs/chain/${cursor}`)) return jsonResponse(secondPage);
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetch);

    const provider = await create("blockstream");
    const transactions = await provider.getTxHistory(ADDRESS, "bitcoin", { limit: 30 });

    expect(transactions.map((transaction) => transaction.hash)).toEqual(
      Array.from({ length: 30 }, (_, index) => historyTransaction(index).txid),
    );
    expect(fetch.mock.calls.map(([input]) => String(input))).toEqual([
      `https://blockstream.info/api/address/${ADDRESS}/txs`,
      `https://blockstream.info/api/address/${ADDRESS}/txs/chain/${cursor}`,
    ]);
  });

  it("answers the second page from the confirmed-chain cursor", async () => {
    const firstPage = Array.from({ length: 25 }, (_, index) => historyTransaction(index));
    const secondPage = Array.from({ length: 25 }, (_, index) => historyTransaction(index + 25));
    const cursor = firstPage.at(-1)!.txid;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/txs")) return jsonResponse(firstPage);
        if (url.endsWith(`/txs/chain/${cursor}`)) return jsonResponse(secondPage);
        return new Response(null, { status: 404 });
      }),
    );

    const provider = await create("blockstream");
    const transactions = await provider.getTxHistory(ADDRESS, "bitcoin", { limit: 25, page: 2 });

    expect(transactions.map((transaction) => transaction.hash)).toEqual(
      secondPage.map((transaction) => transaction.txid),
    );
  });

  it("lists the unspent outputs Blockstream reports for an address", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse([
        {
          txid: TXID,
          vout: 0,
          value: 20_000,
          status: {
            confirmed: true,
            block_height: 947_508,
            block_hash: BLOCK_HASH,
            block_time: 1_749_188_499,
          },
        },
      ]),
    );
    vi.stubGlobal("fetch", fetch);

    const provider = await create("blockstream");
    const utxos = await provider.getUtxos!(ADDRESS, "bitcoin");

    expect(utxos).toEqual([
      {
        txid: TXID,
        vout: 0,
        value: "20000",
        valueFormatted: "0.0002",
        confirmed: true,
        blockNumber: 947_508,
        blockHash: BLOCK_HASH,
        timestamp: "2025-06-06T05:41:39.000Z",
      },
    ]);
    expect(fetch.mock.calls.map(([input]) => String(input))).toEqual([
      `https://blockstream.info/api/address/${ADDRESS}/utxo`,
    ]);
  });

  it("reads one transaction by hash", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({
        txid: TXID,
        vin: [{ prevout: null }],
        vout: [
          { scriptpubkey_type: "p2pk", value: 5_000_000_000 },
          { scriptpubkey_address: ADDRESS, scriptpubkey_type: "p2pkh", value: 1 },
        ],
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

  it("skips an OP_RETURN when pairing transaction detail", async () => {
    const hash = "000000000fdf0c619cd8e0d512c7e2c0da5a5808e60f12f1e0d01522d2986a51";
    const sender = "bc1qjvm9jkrjw9uvsn8905dwa6eau0guyc9laau03a";
    const recipient = "bc1qt2mdkehmphggajer3ur3g8l754scj4fdrmw3rn";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          txid: hash,
          vin: [{ prevout: { scriptpubkey_address: sender, value: 576_504 } }],
          vout: [
            { scriptpubkey_type: "op_return", value: 1 },
            { scriptpubkey_address: recipient, scriptpubkey_type: "v0_p2wpkh", value: 100_000 },
            {
              scriptpubkey_address: "bc1q92qk9r9gwnlcajuls7dgrt30545fs5xuff30an",
              value: 445_166,
            },
          ],
          fee: 31_337,
          status: { confirmed: true, block_height: 674_611 },
        }),
      ),
    );

    const provider = await create("blockstream");
    const transaction = await provider.getTxDetail!(hash, "bitcoin");

    expect(transaction).toMatchObject({
      to: recipient,
      value: "100000",
      valueFormatted: "0.001",
    });
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

  it("reads the OP_RETURN message and the inscription of transaction detail", async () => {
    /* Inscription 0's reveal witness beside the genesis puzzle OP_RETURN, one transaction. */
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          txid: TXID,
          vin: [
            {
              prevout: { scriptpubkey_address: ADDRESS, value: 42_883 },
              witness: FIRST_INSCRIPTION,
            },
          ],
          vout: [
            { scriptpubkey: "0014" + "11".repeat(20), scriptpubkey_address: ADDRESS, value: 5_000 },
            {
              scriptpubkey:
                "6a4cfc49206d616465206120426974636f696e2070757a7a6c65207573696e6720696e666f726d6174696f6e20636f6e7461696e656420696e207468652067656e6573697320626c6f636b2063726561746564206279205361746f73686920746f2067656e6572617465207468652077616c6c65742e0a0a54686520656e74726f70792069732065787472656d656c79206c6f772e2049206469646e2774206576656e206e65656420746f206261636b20616e797468696e672075702e2045766572797468696e672049206e65656465642077617320616c726561647920696e207468652067656e6573697320626c6f636b2e0a0a476f6f64206c75636b21",
              scriptpubkey_type: "op_return",
              value: 0,
            },
          ],
          fee: 250,
          status: { confirmed: true, block_height: 963_629, block_time: 1_787_427_938 },
        }),
      ),
    );

    const provider = await create("blockstream");
    const transaction = await provider.getTxDetail!(TXID, "bitcoin");

    expect(transaction.opReturn?.[0]?.text).toMatch(/^I made a Bitcoin puzzle/);
    expect(transaction.inscriptions?.[0]).toMatchObject({
      input: 0,
      contentType: "image/png",
      size: 793,
    });
  });

  it("reads OP_RETURN messages in address history", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse([
          {
            ...historyTransaction(1),
            vin: [{ prevout: { scriptpubkey_address: ADDRESS, value: 5_000 } }],
            vout: [{ scriptpubkey: "6a0548656c6c6f", scriptpubkey_type: "op_return", value: 0 }],
          },
        ]),
      ),
    );

    const provider = await create("blockstream");
    const [transaction] = await provider.getTxHistory(ADDRESS, "bitcoin", { limit: 1 });

    expect(transaction?.opReturn).toEqual([{ hex: "48656c6c6f", text: "Hello" }]);
    expect(transaction?.inscriptions).toBeUndefined();
  });
});
