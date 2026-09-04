/** Mempool provider tests with stubbed responses for Bitcoin, Litecoin and Pepecoin. */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "../../src/core/registry.js";

// A known Bitcoin address with history
const KNOWN_BTC = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh";

// A Litecoin mining pool address with tens of thousands of transactions
const KNOWN_LTC = "LfdYLbP9F9CpmCX6atZnHZb8KkS8T6x4DK";

/** A Pepecoin puzzle address with confirmed history. */
const KNOWN_PEP = "Pu5spyDwNEQxmWLkUHv779AWNkpMdQ29SZ";

/** Announces the genesis block puzzle in an OP_RETURN that holds three paragraphs of text. */
const GENESIS_PUZZLE_TX = "b691de3657880d9a1eabd2783b1a9fa8c5313ced338495bf10e85727012d7a77";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("Unexpected network request in unit test");
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubJSON(body: unknown) {
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
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

/* Serve one canned transaction whose outputs are the interesting part. */
function stubTxDetail(
  vout: readonly {
    readonly scriptpubkey?: string;
    readonly scriptpubkey_address?: string;
    readonly value: number;
  }[],
): void {
  stubJSON({
    txid: "a".repeat(64),
    vin: [{ prevout: { scriptpubkey_address: KNOWN_BTC, value: 3_000 } }],
    vout,
    fee: 500,
    status: { confirmed: true, block_height: 963_629, block_time: 1_787_427_938 },
  });
}

describe("mempool provider", () => {
  let provider: Awaited<ReturnType<typeof create>>;

  beforeAll(async () => {
    provider = await create("mempool");
  });

  it("reports capabilities", () => {
    const caps = provider.capabilities;
    expect(caps.balances).toBe(true);
    expect(caps.txHistory).toBe(true);
    expect(caps.txDetail).toBe(true);
    expect(caps.gasData).toBe(true);
    expect(caps.blockInfo).toBe(true);
    expect(caps.contractInfo).toBe(false);
    expect(caps.tokenBalances).toBe(false);
  });

  it("keeps confirmed funded and spent totals without losing integer precision", async () => {
    stubJSON({
      chain_stats: {
        funded_txo_count: 2,
        funded_txo_sum: "9007199254740993",
        spent_txo_count: 1,
        spent_txo_sum: "1",
      },
    });

    const balance = await provider.getBalance(KNOWN_BTC, "bitcoin");

    expect(balance).toMatchObject({
      address: KNOWN_BTC,
      chain: "bitcoin",
      balance: "9007199254740992",
      balanceFormatted: "90071992.54740992",
      funded: "9007199254740993",
      spent: "1",
      symbol: "BTC",
    });
  });

  it("routes litecoin calls to litecoinspace.org", async () => {
    const fetch = stubJSON({
      chain_stats: {
        funded_txo_count: 1,
        funded_txo_sum: 10,
        spent_txo_count: 0,
        spent_txo_sum: 0,
      },
    });

    const balance = await provider.getBalance(KNOWN_LTC, "litecoin");

    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      `https://litecoinspace.org/api/address/${KNOWN_LTC}`,
    );
    expect(balance).toMatchObject({ chain: "litecoin", symbol: "LTC" });
  });

  it("routes Pepecoin balances to peppool.space with exact amounts", async () => {
    const fetch = stubJSON({
      chain_stats: {
        funded_txo_count: 2,
        funded_txo_sum: "5000998512000",
        spent_txo_count: 2,
        spent_txo_sum: "5000000000000",
      },
    });

    const balance = await provider.getBalance(KNOWN_PEP, "pepecoin");

    expect(String(fetch.mock.calls[0]?.[0])).toBe(`https://peppool.space/api/address/${KNOWN_PEP}`);
    expect(balance).toMatchObject({
      chain: "pepecoin",
      balance: "998512000",
      balanceFormatted: "9.98512",
      funded: "5000998512000",
      spent: "5000000000000",
      symbol: "PEP",
    });
  });

  it.each(["getGasData", "getBlockInfo"] as const)(
    "rejects unsupported Pepecoin %s reads before network access",
    async (operation) => {
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);

      const read =
        operation === "getGasData"
          ? provider.getGasData!("pepecoin")
          : provider.getBlockInfo!(1, "pepecoin");

      await expect(read).rejects.toMatchObject({
        name: "UnsupportedOperationError",
        provider: "mempool",
      });
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("labels litecoin fee estimates in litoshi/vB", async () => {
    stubJSON({ fastestFee: 2, halfHourFee: 1, hourFee: 1, economyFee: 1, minimumFee: 1 });

    const gas = await provider.getGasData!("litecoin");

    expect(gas.chain).toBe("litecoin");
    expect(gas.unit).toBe("litoshi/vB");
  });

  it("joins custom base URLs with exactly one separator", async () => {
    const fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          chain_stats: {
            funded_txo_count: 1,
            funded_txo_sum: 10,
            spent_txo_count: 0,
            spent_txo_sum: 0,
          },
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetch);

    const customProvider = await create("mempool", { baseUrl: "https://example.test/" });
    await customProvider.getBalance(KNOWN_BTC, "bitcoin");

    expect(String(fetch.mock.calls[0]?.[0])).toBe(`https://example.test/api/address/${KNOWN_BTC}`);
  });

  it("skips OP_RETURN when mapping a sent value and its fee", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([
              {
                txid: "a".repeat(64),
                vin: [{ prevout: { scriptpubkey_address: KNOWN_BTC, value: 100_000 } }],
                vout: [
                  { scriptpubkey: "6a00", scriptpubkey_type: "op_return", value: 0 },
                  {
                    scriptpubkey_address: "bc1qrecipient",
                    scriptpubkey_type: "v0_p2wpkh",
                    value: 70_000,
                  },
                  {
                    scriptpubkey_address: KNOWN_BTC,
                    scriptpubkey_type: "v0_p2wpkh",
                    value: 29_000,
                  },
                ],
                fee: 1_000,
                status: { confirmed: true, block_height: 1, block_time: 1 },
              },
            ]),
            { headers: { "Content-Type": "application/json" } },
          ),
      ),
    );

    const [transaction] = await provider.getTxHistory(KNOWN_BTC, "bitcoin", { limit: 1 });

    expect(transaction).toMatchObject({
      hash: "a".repeat(64),
      blockNumber: 1,
      to: "bc1qrecipient",
      value: "70000",
      valueFormatted: "0.0007",
      fee: "1000",
      status: "success",
    });
  });

  it("handles coinbase transactions with a null prevout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              txid: "4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b",
              vin: [{ prevout: null }],
              vout: [{ value: 5_000_000_000 }],
              fee: 0,
              status: { confirmed: true, block_height: 0, block_time: 1_231_006_505 },
            }),
            { headers: { "Content-Type": "application/json" } },
          ),
      ),
    );

    const transaction = await provider.getTxDetail!(
      "4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b",
      "bitcoin",
    );

    expect(transaction).toMatchObject({
      from: "unknown",
      to: null,
      value: "5000000000",
      valueFormatted: "50",
      fee: "0",
      status: "success",
    });
  });

  it("skips an OP_RETURN when pairing transaction detail", async () => {
    const hash = "000000000fdf0c619cd8e0d512c7e2c0da5a5808e60f12f1e0d01522d2986a51";
    const sender = "bc1qjvm9jkrjw9uvsn8905dwa6eau0guyc9laau03a";
    const recipient = "bc1qt2mdkehmphggajer3ur3g8l754scj4fdrmw3rn";
    stubJSON({
      txid: hash,
      vin: [{ prevout: { scriptpubkey_address: sender, value: 576_504 } }],
      vout: [
        {
          scriptpubkey:
            "6a28f09f98bc2053616372696669636520746f204c61756461212028746f7069633d3532383239313129",
          scriptpubkey_type: "op_return",
          value: 1,
        },
        { scriptpubkey_address: recipient, value: 100_000 },
        { scriptpubkey_address: "bc1q92qk9r9gwnlcajuls7dgrt30545fs5xuff30an", value: 445_166 },
      ],
      fee: 31_337,
      status: { confirmed: true, block_height: 674_611 },
    });

    const transaction = await provider.getTxDetail!(hash, "bitcoin");

    expect(transaction).toMatchObject({
      to: recipient,
      value: "100000",
      valueFormatted: "0.001",
    });
  });

  it("continues confirmed history until the requested limit", async () => {
    const firstPage = Array.from({ length: 25 }, (_, index) => historyTransaction(index));
    const secondPage = Array.from({ length: 25 }, (_, index) => historyTransaction(index + 25));
    const cursor = firstPage.at(-1)!.txid;
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/txs")) {
        return new Response(JSON.stringify(firstPage), {
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.endsWith(`/txs/chain/${cursor}`)) {
        return new Response(JSON.stringify(secondPage), {
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetch);

    const transactions = await provider.getTxHistory(KNOWN_BTC, "bitcoin", { limit: 30 });

    expect(transactions.map((transaction) => transaction.hash)).toEqual(
      Array.from({ length: 30 }, (_, index) => historyTransaction(index).txid),
    );
    expect(fetch.mock.calls.map(([input]) => String(input))).toEqual([
      `https://mempool.space/api/address/${KNOWN_BTC}/txs`,
      `https://mempool.space/api/address/${KNOWN_BTC}/txs/chain/${cursor}`,
    ]);
  });

  it("uses Peppool's cursor query to continue Pepecoin history", async () => {
    const firstPage = Array.from({ length: 25 }, (_, index) => historyTransaction(index));
    const secondPage = Array.from({ length: 25 }, (_, index) => historyTransaction(index + 25));
    const cursor = firstPage.at(-1)!.txid;
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/txs")) {
        return new Response(JSON.stringify(firstPage), {
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.endsWith(`/txs?after_txid=${cursor}`)) {
        return new Response(JSON.stringify(secondPage), {
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetch);

    const transactions = await provider.getTxHistory(KNOWN_PEP, "pepecoin", { limit: 30 });

    expect(transactions.map((transaction) => transaction.hash)).toEqual(
      Array.from({ length: 30 }, (_, index) => historyTransaction(index).txid),
    );
    expect(fetch.mock.calls.map(([input]) => String(input))).toEqual([
      `https://peppool.space/api/address/${KNOWN_PEP}/txs`,
      `https://peppool.space/api/address/${KNOWN_PEP}/txs?after_txid=${cursor}`,
    ]);
  });

  it("reads the message an OP_RETURN output carries", async () => {
    stubTxDetail([
      { scriptpubkey: "0014c30f5f3fccac11feca2fd0322b607c9d73995fde", value: 2_000 },
      {
        scriptpubkey:
          "6a31426f7468206b65797320617265206465726976656420696e646570656e64656e746c792066726f6d2047656e657369732e",
        value: 0,
      },
    ]);

    const tx = await provider.getTxDetail!("a".repeat(64), "bitcoin");

    expect(tx.opReturn).toEqual([
      {
        hex: "426f7468206b65797320617265206465726976656420696e646570656e64656e746c792066726f6d2047656e657369732e",
        text: "Both keys are derived independently from Genesis.",
      },
    ]);
  });

  it("strips the push prefix from an OP_PUSHDATA1 payload", async () => {
    stubTxDetail([{ scriptpubkey: "6a4c0b48656c6c6f2c2042544321", value: 0 }]);

    const tx = await provider.getTxDetail!("a".repeat(64), "bitcoin");

    expect(tx.opReturn).toEqual([{ hex: "48656c6c6f2c2042544321", text: "Hello, BTC!" }]);
  });

  it("keeps every push of a multi-push OP_RETURN separate", async () => {
    stubTxDetail([{ scriptpubkey: "6a0548656c6c6f024f6b", value: 0 }]);

    const tx = await provider.getTxDetail!("a".repeat(64), "bitcoin");

    expect(tx.opReturn).toEqual([
      { hex: "48656c6c6f", text: "Hello" },
      { hex: "4f6b", text: "Ok" },
    ]);
  });

  it("reads a script whose hex arrives uppercase", async () => {
    stubTxDetail([{ scriptpubkey: "6A0548656C6C6F", value: 0 }]);

    const tx = await provider.getTxDetail!("a".repeat(64), "bitcoin");

    expect(tx.opReturn).toEqual([{ hex: "48656c6c6f", text: "Hello" }]);
  });

  it("reads the wider push opcodes and skips a truncated one", async () => {
    stubTxDetail([
      { scriptpubkey: "6a4d050048656c6c6f", value: 0 },
      { scriptpubkey: "6a4e0500000048656c6c6f", value: 0 },
      { scriptpubkey: "6a2048656c6c6f", value: 0 },
    ]);

    const tx = await provider.getTxDetail!("a".repeat(64), "bitcoin");

    expect(tx.opReturn).toEqual([
      { hex: "48656c6c6f", text: "Hello" },
      { hex: "48656c6c6f", text: "Hello" },
    ]);
  });

  it("keeps the constant pushes and the data that follows them", async () => {
    stubTxDetail([
      { scriptpubkey: "6a000548656c6c6f", value: 0 },
      { scriptpubkey: "6a4f5160", value: 0 },
    ]);

    const tx = await provider.getTxDetail!("a".repeat(64), "bitcoin");

    expect(tx.opReturn).toEqual([
      { hex: "", text: "" },
      { hex: "48656c6c6f", text: "Hello" },
      { hex: "81" },
      { hex: "01" },
      { hex: "10" },
    ]);
  });

  it("stops at an opcode that is no longer a push", async () => {
    stubTxDetail([{ scriptpubkey: "6a0548656c6c6f760548656c6c6f", value: 0 }]);

    const tx = await provider.getTxDetail!("a".repeat(64), "bitcoin");

    expect(tx.opReturn).toEqual([{ hex: "48656c6c6f", text: "Hello" }]);
  });

  it("refuses a text reading for payloads carrying invisible format characters", async () => {
    const arabicLetterMark = "6a0461d89c62";
    const rightToLeftOverride = "6a0561e280ae62";
    const zeroWidthSpace = "6a0561e2808b62";
    stubTxDetail([
      { scriptpubkey: arabicLetterMark, value: 0 },
      { scriptpubkey: rightToLeftOverride, value: 0 },
      { scriptpubkey: zeroWidthSpace, value: 0 },
    ]);

    const tx = await provider.getTxDetail!("a".repeat(64), "bitcoin");

    expect(tx.opReturn).toEqual([
      { hex: "61d89c62" },
      { hex: "61e280ae62" },
      { hex: "61e2808b62" },
    ]);
  });

  it("hands back hex when a payload hides behind a byte order mark", async () => {
    const bomOnly = "6a03efbbbf";
    const bomThenText = "6a05efbbbf4869";
    stubTxDetail([
      { scriptpubkey: bomOnly, value: 0 },
      { scriptpubkey: bomThenText, value: 0 },
    ]);

    const tx = await provider.getTxDetail!("a".repeat(64), "bitcoin");

    expect(tx.opReturn).toEqual([{ hex: "efbbbf" }, { hex: "efbbbf4869" }]);
  });

  it("keeps a text reading for an emoji that needs a variation selector", async () => {
    stubTxDetail([{ scriptpubkey: "6a06e29da4efb88f", value: 0 }]);

    const tx = await provider.getTxDetail!("a".repeat(64), "bitcoin");

    expect(tx.opReturn).toEqual([{ hex: "e29da4efb88f", text: "❤️" }]);
  });

  it("leaves a payload without a text reading when the bytes are not valid UTF-8", async () => {
    stubTxDetail([{ scriptpubkey: "6a04ff00ff00", value: 0 }]);

    const tx = await provider.getTxDetail!("a".repeat(64), "bitcoin");

    expect(tx.opReturn).toEqual([{ hex: "ff00ff00" }]);
  });

  it("refuses a text reading for payloads carrying terminal controls", async () => {
    stubTxDetail([
      { scriptpubkey: "6a0361006b", value: 0 },
      { scriptpubkey: "6a0568c29b6d21", value: 0 },
      { scriptpubkey: "6a03610d62", value: 0 },
    ]);

    const tx = await provider.getTxDetail!("a".repeat(64), "bitcoin");

    expect(tx.opReturn).toEqual([{ hex: "61006b" }, { hex: "68c29b6d21" }, { hex: "610d62" }]);
  });

  it("omits opReturn for a transaction without one", async () => {
    stubTxDetail([{ scriptpubkey: "0014c30f5f3fccac11feca2fd0322b607c9d73995fde", value: 2_000 }]);

    const tx = await provider.getTxDetail!("a".repeat(64), "bitcoin");

    expect(tx.opReturn).toBeUndefined();
  });

  it("reads OP_RETURN messages from transaction history too", async () => {
    stubJSON([
      {
        txid: "b".repeat(64),
        vin: [{ prevout: { scriptpubkey_address: KNOWN_BTC, value: 5_000 } }],
        vout: [
          { scriptpubkey: "6a0548656c6c6f", value: 0 },
          { scriptpubkey_address: KNOWN_BTC, value: 4_000 },
        ],
        fee: 1_000,
        status: { confirmed: true, block_height: 963_837, block_time: 1_787_000_000 },
      },
    ]);

    const [transaction] = await provider.getTxHistory(KNOWN_BTC, "bitcoin", { limit: 1 });

    expect(transaction?.opReturn).toEqual([{ hex: "48656c6c6f", text: "Hello" }]);
  });

  it("keeps the paragraph breaks of an OP_RETURN message of 252 bytes", async () => {
    const message = [
      "I made a Bitcoin puzzle using information contained in the genesis block created by Satoshi to generate the wallet.",
      "The entropy is extremely low. I didn't even need to back anything up. Everything I needed was already in the genesis block.",
      "Good luck!",
    ].join("\n\n");
    const payload = Buffer.from(message, "utf8");
    stubTxDetail([
      {
        scriptpubkey_address: "bc1qfkhx02v89u2qyyyljeczw6hu9sr437y44t7ae5yf09thrdukfqesnjg2wj",
        value: 5_000,
      },
      { scriptpubkey: `6a4cfc${payload.toString("hex")}`, value: 0 },
    ]);

    const tx = await provider.getTxDetail!(GENESIS_PUZZLE_TX, "bitcoin");

    expect(payload).toHaveLength(252);
    expect(tx.opReturn).toEqual([{ hex: payload.toString("hex"), text: message }]);
  });

  it.each([
    ["bitcoin", "https://mempool.space"],
    ["litecoin", "https://litecoinspace.org"],
  ] as const)("gets %s blocks from the JSON endpoint", async (chain, host) => {
    const height = 900_000;
    const block = {
      id: "0".repeat(64),
      height,
      timestamp: 1_749_188_499,
      tx_count: 1_562,
      size: 1_920_777,
      weight: 3_130_335,
      previousblockhash: "1".repeat(64),
    };
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/block-height/")) return new Response(block.id);
      if (url.includes("/blocks/")) {
        return new Response(JSON.stringify([block]), {
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetch);

    const result = await provider.getBlockInfo!(height, chain);

    expect(result).toMatchObject({
      number: height,
      hash: block.id,
      timestamp: new Date(block.timestamp * 1_000).toISOString(),
      txCount: block.tx_count,
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(String(fetch.mock.calls[0]?.[0])).toBe(`${host}/api/blocks/${height}`);
  });

  it("rejects a block page that does not contain the requested height", async () => {
    stubJSON([{ id: "0".repeat(64), height: 899_999 }]);

    await expect(provider.getBlockInfo!(900_000, "bitcoin")).rejects.toMatchObject({
      name: "NotFoundError",
      provider: "mempool",
      message: "Not found: Block 900000",
    });
  });

  it("maps Bitcoin fee recommendations onto the gas tiers", async () => {
    const fetch = stubJSON({
      fastestFee: 4,
      halfHourFee: 4,
      hourFee: 3,
      economyFee: 2,
      minimumFee: 1,
    });

    await expect(provider.getGasData!("bitcoin")).resolves.toEqual({
      chain: "bitcoin",
      unit: "sat/vB",
      safeGasPrice: "2",
      proposedGasPrice: "4",
      fastGasPrice: "4",
      priorityFee: "1",
    });
    expect(String(fetch.mock.calls[0]?.[0])).toBe("https://mempool.space/api/v1/fees/recommended");
  });

  it("getBalance throws for a chain mempool does not serve", async () => {
    await expect(provider.getBalance(KNOWN_BTC, "ethereum")).rejects.toThrow();
  });
});
