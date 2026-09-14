import { describe, expect, it, vi } from "vitest";
import {
  getEsploraAddressHistory,
  getEsploraUtxos,
  selectEsploraRecipientOutput,
} from "../../src/core/esplora.js";

const ADDRESS = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa";

function historyTransaction(index: number) {
  return {
    txid: index.toString(16).padStart(64, "0"),
    status: { confirmed: true },
  };
}

describe("Esplora recipient selection", () => {
  it("skips OP_RETURN and the excluded address", () => {
    const output = selectEsploraRecipientOutput(
      [
        { scriptpubkey_type: "op_return", value: 0 },
        { scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: ADDRESS, value: 29_000 },
        { scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "recipient", value: 70_000 },
      ],
      ADDRESS,
    );

    expect(output).toEqual({ address: "recipient", value: 70_000 });
  });

  it("falls back to the excluded address when it is the only transfer output", () => {
    const output = selectEsploraRecipientOutput(
      [
        { scriptpubkey_type: "op_return", value: 0 },
        { scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: ADDRESS, value: 29_000 },
      ],
      ADDRESS,
    );

    expect(output).toEqual({ address: ADDRESS, value: 29_000 });
  });

  it("falls back to the first raw output when every output is OP_RETURN", () => {
    const output = selectEsploraRecipientOutput([
      { scriptpubkey_type: "op_return", value: 1 },
      { scriptpubkey_type: "op_return", value: 2 },
    ]);

    expect(output).toEqual({ address: null, value: 1 });
  });
});

describe("Esplora unspent outputs", () => {
  it("rejects an unsafe address before requesting outputs", async () => {
    const fetchUtxos = vi.fn(async () => []);

    await expect(getEsploraUtxos("../admin", fetchUtxos)).rejects.toThrow(/separator|traversal/);
    expect(fetchUtxos).not.toHaveBeenCalled();
  });

  it("keeps a large value exact and leaves a mempool output without a block", async () => {
    const fetchUtxos = vi.fn(async () => [
      {
        txid: "a".repeat(64),
        vout: 1,
        value: "9007199254740993",
        status: {
          confirmed: true,
          block_height: 947_507,
          block_hash: "b".repeat(64),
          block_time: 1_749_188_499,
        },
      },
      { txid: "c".repeat(64), vout: 0, value: 546, status: { confirmed: false } },
    ]);

    const utxos = await getEsploraUtxos(ADDRESS, fetchUtxos);

    expect(fetchUtxos.mock.calls.map(([path]) => path)).toEqual([`/api/address/${ADDRESS}/utxo`]);
    expect(utxos).toEqual([
      {
        txid: "a".repeat(64),
        vout: 1,
        value: "9007199254740993",
        valueFormatted: "90071992.54740993",
        confirmed: true,
        blockNumber: 947_507,
        blockHash: "b".repeat(64),
        timestamp: "2025-06-06T05:41:39.000Z",
      },
      {
        txid: "c".repeat(64),
        vout: 0,
        value: "546",
        valueFormatted: "0.00000546",
        confirmed: false,
        blockNumber: null,
        blockHash: null,
        timestamp: undefined,
      },
    ]);
  });
});

describe("Esplora address history", () => {
  it("rejects an unsafe address before requesting a page", async () => {
    const fetchPage = vi.fn(async () => [historyTransaction(0)]);

    await expect(getEsploraAddressHistory("../admin", 30, fetchPage)).rejects.toThrow(
      /separator|traversal/,
    );
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("stops before appending a page that repeats its cursor", async () => {
    const page = Array.from({ length: 25 }, (_, index) => historyTransaction(index));
    const cursor = page.at(-1)!.txid;
    const fetchPage = vi.fn(async () => page);

    const transactions = await getEsploraAddressHistory(ADDRESS, 30, fetchPage);

    expect(transactions).toEqual(page);
    expect(fetchPage.mock.calls.map(([path]) => path)).toEqual([
      `/api/address/${ADDRESS}/txs`,
      `/api/address/${ADDRESS}/txs/chain/${cursor}`,
    ]);
  });
});
