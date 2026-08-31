/**
 * Explorers - Mempool.space integration tests for Bitcoin and compatible forks.
 *
 * Live roundtrips cover mempool.space, litecoinspace.org and peppool.space.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { create } from "../../src/core/registry.js";

// A known Bitcoin address with history
const KNOWN_BTC = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh";

// A Litecoin mining pool address with tens of thousands of transactions
const KNOWN_LTC = "LfdYLbP9F9CpmCX6atZnHZb8KkS8T6x4DK";

/** A Pepecoin puzzle address with confirmed history. */
const KNOWN_PEP = "Pu5spyDwNEQxmWLkUHv779AWNkpMdQ29SZ";

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

  it("getBalance returns BTC balance for known address", async () => {
    const balance = await provider.getBalance(KNOWN_BTC, "bitcoin");

    expect(balance.address).toBe(KNOWN_BTC);
    expect(balance.chain).toBe("bitcoin");
    expect(balance.symbol).toBe("BTC");
    expect(balance.balance).toMatch(/^-?\d+$/);
    expect(Number(balance.balanceFormatted)).toBeGreaterThan(0);
  });

  it("getBalance returns LTC balance from litecoinspace", async () => {
    const balance = await provider.getBalance(KNOWN_LTC, "litecoin");

    expect(balance.address).toBe(KNOWN_LTC);
    expect(balance.chain).toBe("litecoin");
    expect(balance.symbol).toBe("LTC");
    expect(balance.balance).toMatch(/^-?\d+$/);
    expect(Number(balance.balanceFormatted)).toBeGreaterThan(0);
  });

  it("getBalance returns PEP balance from peppool", async () => {
    const balance = await provider.getBalance(KNOWN_PEP, "pepecoin");

    expect(balance.address).toBe(KNOWN_PEP);
    expect(balance.chain).toBe("pepecoin");
    expect(balance.symbol).toBe("PEP");
    expect(balance.balance).toMatch(/^-?\d+$/);
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
      balance: "9007199254740992",
      funded: "9007199254740993",
      spent: "1",
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

    await provider.getBalance(KNOWN_LTC, "litecoin");

    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      `https://litecoinspace.org/api/address/${KNOWN_LTC}`,
    );
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

  it("separates a sent value from its transaction fee", async () => {
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
                  { scriptpubkey_address: "bc1qrecipient", value: 70_000 },
                  { scriptpubkey_address: KNOWN_BTC, value: 29_000 },
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
      value: "70000",
      valueFormatted: "0.0007",
      fee: "1000",
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

  it("pairs transaction detail with the first output value", async () => {
    const hash = "221f3d64a45a95d6cf05a3fe5a84fac292790d39b05929ed213a492e02177160";
    const sender = "bc1q4g77af2qqu7hjwh873ej7pltj7pvmmw7t9nz3u";
    const recipient = "bc1q7x3p3rkmkxgf20n3apkccqcmn5mdtsf8zx5227";
    stubJSON({
      txid: hash,
      vin: [{ prevout: { scriptpubkey_address: sender, value: 524_288 } }],
      vout: [
        { scriptpubkey_address: recipient, value: 500_000 },
        { scriptpubkey_address: sender, value: 23_199 },
      ],
      fee: 1_089,
      status: { confirmed: true, block_height: 856_786 },
    });

    const transaction = await provider.getTxDetail!(hash, "bitcoin");

    expect(transaction).toMatchObject({
      to: recipient,
      value: "500000",
      valueFormatted: "0.005",
    });
  });

  it("getTxHistory returns BTC transactions", async () => {
    const txs = await provider.getTxHistory(KNOWN_BTC, "bitcoin", { limit: 3 });

    expect(Array.isArray(txs)).toBe(true);
    expect(txs.length).toBeGreaterThan(0);
    expect(txs.length).toBeLessThanOrEqual(3);

    const tx = txs[0]!;
    expect(tx.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(tx.status).toBe("success");
    expect(tx.blockNumber).toBeGreaterThan(0);
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

  it("reads a live 252-byte OP_RETURN message", async () => {
    const tx = await provider.getTxDetail!(
      "b691de3657880d9a1eabd2783b1a9fa8c5313ced338495bf10e85727012d7a77",
      "bitcoin",
    );

    expect(tx.opReturn?.[0]?.text).toContain(
      "I made a Bitcoin puzzle using information contained in the genesis block",
    );
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

  it("getGasData returns fee estimates", async () => {
    const gas = await provider.getGasData!("bitcoin");

    expect(gas.chain).toBe("bitcoin");
    expect(gas.unit).toBe("sat/vB");
    expect(gas.proposedGasPrice).toBeTruthy();
    expect(Number(gas.proposedGasPrice)).toBeGreaterThan(0);
  });

  it("getBalance throws for a chain mempool does not serve", async () => {
    await expect(provider.getBalance(KNOWN_BTC, "ethereum")).rejects.toThrow();
  });
});
