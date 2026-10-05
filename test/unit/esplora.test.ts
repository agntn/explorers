import { describe, expect, it, vi } from "vite-plus/test";
import {
  getEsploraAddressHistory,
  getEsploraPubkey,
  getEsploraUtxos,
  selectEsploraRecipientOutput,
} from "../../src/core/esplora.ts";
import type { EsploraKeyTransaction } from "../../src/core/esplora.ts";

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

    await expect(
      getEsploraAddressHistory("../admin", { limit: 30, offset: 0 }, fetchPage),
    ).rejects.toThrow(/separator|traversal/);
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("stops before appending a page that repeats its cursor", async () => {
    const page = Array.from({ length: 25 }, (_, index) => historyTransaction(index));
    const cursor = page.at(-1)!.txid;
    const fetchPage = vi.fn(async () => page);

    const transactions = await getEsploraAddressHistory(
      ADDRESS,
      { limit: 30, offset: 0 },
      fetchPage,
    );

    expect(transactions).toEqual(page);
    expect(fetchPage.mock.calls.map(([path]) => path)).toEqual([
      `/api/address/${ADDRESS}/txs`,
      `/api/address/${ADDRESS}/txs/chain/${cursor}`,
    ]);
  });
});

/* Inputs and outputs as mempool.space served them, signatures and all. */
const P2PKH = "1GSMG1JC9wtdSwfwApgj2xcmJPAwx7prBe";
const P2PKH_KEY =
  "04f4d1bbd91e65e2a019566a17574e97dae908b784b388891848007e4f55d5a4649c73d25fc5ed8fd7227cab0be4e576c0c6404db5aa546286563e4be12bf33559";
const P2PKH_INPUT = {
  txid: "2aa9a4a90be819d5122d70c993280785a0508f163521e7b38cebb4db0b071b13",
  prevout: {
    scriptpubkey: "76a914a9553269572a317e39f0f518cb87c1a0ee1dbae488ac",
    scriptpubkey_type: "p2pkh",
    scriptpubkey_address: P2PKH,
  },
  scriptsig_asm: `OP_PUSHBYTES_71 304402201df5cf8403c9309aba324ef94a43551a32a258326009abb4ac1153c06de327d002201640b665814359b3eae6cb1deca9f61cc90b968bf62693ed8f6e79d2544a3df601 OP_PUSHBYTES_65 ${P2PKH_KEY}`,
};
const P2WPKH_INPUT = {
  txid: "a0354c0a2155a56142c8d98a7c8210a79cce068b8cafd0f563e261266b313e24",
  prevout: {
    scriptpubkey: "00141d93f7fadb1ec1995c32a627ea51521e4fac27cf",
    scriptpubkey_type: "v0_p2wpkh",
    scriptpubkey_address: "bc1qrkfl07kmrmqejhpj5cn7552jre86cf70wttmdk",
  },
  scriptsig_asm: "",
  witness: [
    "30440220496d8069ce65513995036b454141e806a5078464bb1224aebe83fec97688df370220740d9c719af93386bbc5ef664ed0a1e1a5a14217af26345b07b7b1314b68447a01",
    "034c67274270bd598971ad50e8f719fc483d277c7a47055f026bebde70801c82d3",
  ],
};
const NESTED_P2WPKH_INPUT = {
  txid: "44ec81c24f4883908207f2caa8bee24f9ddf9d82c632453c7309e7b245ac713b",
  prevout: {
    scriptpubkey: "a9142664c72e28fcbb133d372e07f8bef0184407015a87",
    scriptpubkey_type: "p2sh",
    scriptpubkey_address: "35C2L1pCgwzBHNcDcVL1a5RuoefeWqyjAR",
  },
  scriptsig_asm: "OP_PUSHBYTES_22 00142a7e2251c22c3cc473bacc10da324db0d5063848",
  inner_redeemscript_asm: "OP_0 OP_PUSHBYTES_20 2a7e2251c22c3cc473bacc10da324db0d5063848",
  witness: [
    "304402201b560107dfe9cd0cf37c7cb87e48761ecb7aef7b181a148a8032fcde361bc61b02204c09ef507626e496f46e550e6f65f8692edeba68ef38b5e86e637a00fd832d7a01",
    "030931abd4fb78d81f6566d5860d868f79678a932a715a1620cac1acac40bd04f5",
  ],
};
const TAPROOT = "bc1pqqltxc9d86emzyd99a2h3m2kctf397607uflq38vuzuqnh6rmx5sdmccjt";
const TAPROOT_OUTPUT = {
  scriptpubkey: "5120003eb360ad3eb3b111a52f5578ed56c2d312fb4ff713f044ece0b809df43d9a9",
  scriptpubkey_type: "v1_p2tr",
  scriptpubkey_address: TAPROOT,
};

/* One feed row; `index` makes its txid. */
function keyRow(
  index: number,
  vin: EsploraKeyTransaction["vin"] = [],
  vout: EsploraKeyTransaction["vout"] = [],
): EsploraKeyTransaction {
  return { txid: index.toString(16).padStart(64, "0"), status: { confirmed: true }, vin, vout };
}

/* The address counters, with every spend confirmed. */
function stats(spent: number, transactions: number) {
  return async () => ({
    chain_stats: { spent_txo_count: spent, tx_count: transactions },
    mempool_stats: { spent_txo_count: 0, tx_count: 0 },
  });
}

describe("Esplora pubkey", () => {
  it("rejects an unsafe address before reading its counters", async () => {
    const fetchStats = vi.fn(stats(0, 0));

    await expect(
      getEsploraPubkey(
        "../admin",
        fetchStats,
        vi.fn(async () => []),
      ),
    ).rejects.toThrow(/separator|traversal/);
    expect(fetchStats).not.toHaveBeenCalled();
  });

  it("reads a P2PKH key on the second page and stops there", async () => {
    const first = Array.from({ length: 25 }, (_, index) => keyRow(index));
    const second = [
      keyRow(100, [P2PKH_INPUT]),
      ...Array.from({ length: 24 }, (_, index) => keyRow(200 + index)),
    ];
    const fetchPage = vi.fn(async (path: string) => (path.includes("/chain/") ? second : first));

    const reveal = await getEsploraPubkey(P2PKH, stats(6, 127), fetchPage);

    expect(reveal).toEqual({
      address: P2PKH,
      pubkey: P2PKH_KEY,
      source: "spend",
      txid: keyRow(100).txid,
      spent: true,
    });
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["P2WPKH", P2WPKH_INPUT, "034c67274270bd598971ad50e8f719fc483d277c7a47055f026bebde70801c82d3"],
    [
      "P2SH-wrapped P2WPKH",
      NESTED_P2WPKH_INPUT,
      "030931abd4fb78d81f6566d5860d868f79678a932a715a1620cac1acac40bd04f5",
    ],
  ])("reads the %s key from the witness", async (_type, input, pubkey) => {
    const address = input.prevout.scriptpubkey_address;
    const reveal = await getEsploraPubkey(
      address,
      stats(1, 2),
      vi.fn(async () => [keyRow(1, [input])]),
    );

    expect(reveal).toMatchObject({ pubkey, source: "spend", txid: keyRow(1).txid });
  });

  it.each([
    ["a P2WPKH spend", P2WPKH_INPUT.prevout.scriptpubkey_address, [keyRow(1, [P2WPKH_INPUT])]],
    ["a taproot output", TAPROOT, [keyRow(1, [], [TAPROOT_OUTPUT])]],
  ])("matches %s to an address written in capitals", async (_case, address, rows) => {
    const reveal = await getEsploraPubkey(
      address.toUpperCase(),
      stats(1, 1),
      vi.fn(async () => rows),
    );

    expect(reveal.pubkey).not.toBeNull();
    expect(reveal.address).toBe(address.toUpperCase());
  });

  it("reads a taproot output key from the first page of an address that never spent", async () => {
    const fetchPage = vi.fn(async () => [keyRow(7, [], [TAPROOT_OUTPUT])]);

    const reveal = await getEsploraPubkey(TAPROOT, stats(0, 1), fetchPage);

    expect(reveal).toEqual({
      address: TAPROOT,
      pubkey: "003eb360ad3eb3b111a52f5578ed56c2d312fb4ff713f044ece0b809df43d9a9",
      source: "output",
      txid: keyRow(7).txid,
      spent: false,
    });
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("names the funding transaction when a taproot key shows in a spend", async () => {
    const input = { txid: "f".repeat(64), prevout: TAPROOT_OUTPUT, witness: ["00".repeat(64)] };

    const reveal = await getEsploraPubkey(
      TAPROOT,
      stats(1, 2),
      vi.fn(async () => [keyRow(1, [input])]),
    );

    expect(reveal).toMatchObject({ source: "output", txid: "f".repeat(64) });
  });

  it("reads one page for an address that never spent, however long its feed", async () => {
    let row = 0;
    const fetchPage = vi.fn(async () =>
      Array.from({ length: 25 }, () => {
        row += 1;
        return keyRow(row);
      }),
    );

    const reveal = await getEsploraPubkey(P2PKH, stats(0, 5000), fetchPage);

    expect(reveal).toMatchObject({ pubkey: null, spent: false });
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("answers from the counters alone for an address with no transactions", async () => {
    const fetchPage = vi.fn(async () => [keyRow(0)]);

    const reveal = await getEsploraPubkey(P2PKH, stats(0, 0), fetchPage);

    expect(reveal).toEqual({
      address: P2PKH,
      pubkey: null,
      source: null,
      txid: null,
      spent: false,
    });
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("stops after 1000 rows of spends it cannot read", async () => {
    const multisig = {
      ...NESTED_P2WPKH_INPUT,
      inner_redeemscript_asm: "OP_PUSHNUM_1 OP_PUSHBYTES_33 02aa OP_PUSHNUM_1 OP_CHECKMULTISIG",
    };
    let row = 0;
    const fetchPage = vi.fn(async () =>
      Array.from({ length: 25 }, () => {
        row += 1;
        return keyRow(row, [multisig]);
      }),
    );

    const reveal = await getEsploraPubkey(
      multisig.prevout.scriptpubkey_address,
      stats(5000, 5000),
      fetchPage,
    );

    expect(reveal).toMatchObject({ pubkey: null, source: null, txid: null, spent: true });
    expect(fetchPage).toHaveBeenCalledTimes(40);
  });
});
