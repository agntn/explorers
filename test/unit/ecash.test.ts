import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  ExplorerError,
  NotFoundError,
  UnsupportedChainError,
  UnsupportedOperationError,
} from "../../src/core/errors.ts";
import { create } from "../../src/core/registry.ts";
import { ECash } from "../../src/providers/ecash.ts";

const BASE = "https://explorer.e.cash";
const ADDRESS = "ecash:qq5r308v2mkh6x5mkqpr6wytszz6f9r7qcnfttev0z";
const HISTORY_PATH = `/api/address/${encodeURIComponent(ADDRESS)}/transactions`;

/* Rows as explorer.e.cash sent them: a token payment in, then a spend paying a 467 satoshi fee. */
const received = {
  txHash: "d7a1bb289fefb1e984b0b1e7dd39d98812f9f75ffda56559597aa91b42defc07",
  blockHeight: 967_331,
  timestamp: 1_789_722_493,
  isCoinbase: false,
  size: 467,
  numInputs: 2,
  numOutputs: 4,
  stats: {
    satsInput: 84_560_346,
    satsOutput: 84_559_879,
    deltaSats: 546,
    deltaTokens: 10_000,
    tokenInput: 543_815_920,
    tokenOutput: 543_815_920,
    doesBurnSlp: false,
  },
  tokenId: "aed861a31b96934b88c0252ede135cb9700d7649f69191235087a3030e553cb1",
  token: {
    tokenId: "aed861a31b96934b88c0252ede135cb9700d7649f69191235087a3030e553cb1",
    tokenType: 1,
    tokenTicker: "CACHET",
    tokenName: "Cachet",
    decimals: 2,
  },
  isFinal: true,
};

const sent = {
  txHash: "655732f46089de026cd29fc2dbdc017226d88510e8e0ac56162e68a8365938d2",
  blockHeight: 967_331,
  timestamp: 1_789_722_478,
  isCoinbase: false,
  size: 467,
  numInputs: 3,
  numOutputs: 1,
  stats: {
    satsInput: 35_403,
    satsOutput: 34_936,
    deltaSats: -35_403,
    deltaTokens: 0,
    tokenInput: 0,
    tokenOutput: 0,
    doesBurnSlp: false,
  },
  tokenId: null,
  token: null,
  isFinal: true,
};

/* The coinbase of block 963629, read from the block's transaction list. */
const coinbase = {
  txHash: "a6ddfa466d800f783165256b6349e30a7dc58d03f4de88d84fb69a13eba7d07a",
  blockHeight: 963_629,
  timestamp: 1_787_517_911,
  isCoinbase: true,
  size: 241,
  numInputs: 1,
  numOutputs: 3,
  stats: {
    satsInput: 0,
    satsOutput: 312_500_774,
    deltaSats: 312_500_774,
    deltaTokens: 0,
    tokenInput: 0,
    tokenOutput: 0,
    doesBurnSlp: false,
  },
  tokenId: null,
  token: null,
  isFinal: true,
};

/* A row from /api/mempool: no block yet, and its change is the fee the spender paid. */
const pending = {
  txHash: "438439b63f3faadd25e11e27a9cf09a4cf296ebe98e1d0211dcef3d2b88d36dd",
  blockHeight: null,
  timestamp: 1_791_363_603,
  isCoinbase: false,
  size: 1281,
  numInputs: 5,
  numOutputs: 4,
  stats: {
    satsInput: 13_081_082_404,
    satsOutput: 13_081_081_123,
    deltaSats: -1281,
    deltaTokens: 0,
    tokenInput: 36_522_079,
    tokenOutput: 36_522_079,
    doesBurnSlp: false,
  },
  tokenId: "0387947fd575db4fb19a3e322f635dec37fd192b5941625b66bc4b2c3008cbf0",
  token: null,
  isFinal: true,
};

const BLOCK = "00000000000000000aba5a2a742dd69aae8279a51e4545ac2ca223ffc13579fc";
const PARENT = "0000000000000000a506d74bbc79928d948ec9e22376eca3433bd3d7f81184b6";
const GENESIS = "000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f";

const blocks = {
  data: [
    {
      hash: BLOCK,
      height: 963_629,
      timestamp: 1_787_517_911,
      difficulty: 6_617_701_120.150_472,
      size: 887,
      numTxs: 3,
      isFinal: true,
    },
    {
      hash: PARENT,
      height: 963_628,
      timestamp: 1_787_517_730,
      difficulty: 6_612_725_989.506_872,
      size: 1513,
      numTxs: 3,
      isFinal: true,
    },
  ],
};

/* Answer every request through `route` and keep the URLs asked for, in order. */
function stubApi(route: (url: URL) => unknown): URL[] {
  const urls: URL[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: string | URL | Request) => {
      const url = new URL(request instanceof Request ? request.url : String(request));
      urls.push(url);
      const answer = route(url);
      return answer instanceof Response ? answer : Response.json(answer);
    }),
  );
  return urls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ecash provider", () => {
  it("reports the history and blocks the explorer's JSON covers, and nothing else", async () => {
    const provider = await create("ecash");

    expect(provider.capabilities).toEqual({
      balances: false,
      txHistory: true,
      txDetail: false,
      utxos: false,
      pubkeys: false,
      contractInfo: false,
      tokenBalances: false,
      tokenTransfers: false,
      gasData: false,
      blockInfo: true,
    });
    expect(provider.getTxDetail).toBeUndefined();
    expect(provider.getUtxos).toBeUndefined();
  });

  it("refuses a balance without asking, since only the HTML page shows one", async () => {
    const urls = stubApi(() => ({}));
    const provider = new ECash();

    await expect(provider.getBalance(ADDRESS)).rejects.toBeInstanceOf(UnsupportedOperationError);
    await expect(provider.getBalance(ADDRESS, "bitcoincash")).rejects.toBeInstanceOf(
      UnsupportedChainError,
    );
    expect(urls).toEqual([]);
  });

  it("reads a receive and a send from the change the address saw", async () => {
    const urls = stubApi(() => ({ data: [received, sent] }));

    const [payment, spend] = await new ECash().getTxHistory(ADDRESS);

    expect(urls.map((url) => `${url.origin}${url.pathname}${url.search}`)).toEqual([
      `${BASE}${HISTORY_PATH}?page=0&take=100`,
    ]);
    expect(payment).toMatchObject({
      hash: received.txHash,
      blockNumber: 967_331,
      timestamp: "2026-09-18T09:08:13.000Z",
      from: "",
      to: ADDRESS,
      value: "546",
      valueFormatted: "5.46",
      fee: "467",
      status: "success",
      isContractInteraction: false,
      tokenTransfers: [],
    });
    expect(spend).toMatchObject({
      hash: sent.txHash,
      from: ADDRESS,
      to: null,
      value: "34936",
      valueFormatted: "349.36",
      fee: "467",
      status: "success",
    });
  });

  it("asks for an address without the prefix or in capitals in the prefixed lowercase form", async () => {
    const urls = stubApi(() => ({ data: [sent] }));
    const provider = new ECash();

    const [bare] = await provider.getTxHistory(ADDRESS.slice("ecash:".length));
    const [shouted] = await provider.getTxHistory(ADDRESS.toUpperCase());

    expect(urls.map((url) => url.pathname)).toEqual([HISTORY_PATH, HISTORY_PATH]);
    expect(bare?.from).toBe(ADDRESS);
    expect(shouted?.from).toBe(ADDRESS);
  });

  it("turns a page into Chronik's page index and keeps a limit within 100", async () => {
    const urls = stubApi(() => ({ data: [] }));
    const provider = new ECash({ baseUrl: "https://explorer.example/" });

    await provider.getTxHistory(ADDRESS, "ecash", { page: 3, limit: 20 });
    await provider.getTxHistory(ADDRESS, "ecash", { limit: 500, sort: "desc" });

    expect(urls.map((url) => `${url.origin}${url.pathname}${url.search}`)).toEqual([
      `https://explorer.example${HISTORY_PATH}?page=2&take=20`,
      `https://explorer.example${HISTORY_PATH}?page=0&take=100`,
    ]);
  });

  it("rejects what the explorer cannot list before any request", async () => {
    const urls = stubApi(() => ({ data: [] }));
    const provider = new ECash();

    await expect(provider.getTxHistory(ADDRESS, "ecash", { sort: "asc" })).rejects.toThrow(
      "newest first only",
    );
    await expect(provider.getTxHistory(ADDRESS, "ecash", { startBlock: 1 })).rejects.toThrow(
      "no block bounds",
    );
    await expect(provider.getTxHistory(ADDRESS, "ecash", { endBlock: 1 })).rejects.toThrow(
      "no block bounds",
    );
    await expect(provider.getTxHistory(ADDRESS, "ecash", { page: 0 })).rejects.toThrow(
      "pages start at 1",
    );
    await expect(
      provider.getTxHistory("bitcoincash:qq5r308v2mkh6x5mkqpr6wytszz6f9r7qcnfttev0z"),
    ).rejects.toThrow("Invalid eCash address");
    await expect(provider.getTxHistory(ADDRESS, "bitcoin")).rejects.toBeInstanceOf(
      UnsupportedChainError,
    );
    expect(urls).toEqual([]);
  });

  it("reads a block reward with no fee and a mempool transaction pending at block zero", async () => {
    stubApi(() => ({ data: [coinbase, pending] }));

    const [reward, waiting] = await new ECash().getTxHistory(ADDRESS);

    expect(reward).toMatchObject({ from: "", to: ADDRESS, value: "312500774", status: "success" });
    expect(reward).not.toHaveProperty("fee");
    expect(waiting).toMatchObject({
      blockNumber: 0,
      timestamp: "2026-10-07T09:00:03.000Z",
      from: ADDRESS,
      value: "0",
      fee: "1281",
      status: "pending",
    });
  });

  it("keeps the row the explorer sent as raw, so a response with raw still serializes", async () => {
    stubApi(() => ({ data: [received] }));

    const transactions = await new ECash().getTxHistory(ADDRESS);

    expect(transactions[0]?.raw).toEqual(received);
    expect(() => JSON.stringify(transactions)).not.toThrow();
  });

  it("throws ExplorerError for a history that is not the explorer's shape", async () => {
    stubApi(() => ({ data: [{ ...sent, stats: { deltaSats: "lots" } }] }));

    await expect(new ECash().getTxHistory(ADDRESS)).rejects.toThrow(
      new ExplorerError("Unexpected eCash Explorer history response", "ecash"),
    );
  });

  it("refuses a time no Date can hold with ExplorerError instead of a RangeError", async () => {
    stubApi((url) =>
      url.pathname.startsWith("/api/blocks/")
        ? { data: [{ ...blocks.data[0], timestamp: 1e15 }] }
        : { data: [{ ...sent, timestamp: 1e15 }] },
    );
    const provider = new ECash();

    await expect(provider.getTxHistory(ADDRESS)).rejects.toBeInstanceOf(ExplorerError);
    await expect(provider.getBlockInfo(963_629)).rejects.toBeInstanceOf(ExplorerError);
  });

  it("reads a block and its parent from one range", async () => {
    const urls = stubApi(() => blocks);

    const block = await new ECash().getBlockInfo(963_629);

    expect(urls.map((url) => url.pathname)).toEqual(["/api/blocks/963628/963629"]);
    expect(block).toEqual({
      number: 963_629,
      hash: BLOCK,
      parentHash: PARENT,
      timestamp: "2026-08-23T20:45:11.000Z",
      miner: "",
      gasUsed: "0",
      gasLimit: "0",
      txCount: 3,
    });
  });

  it("gives the genesis block the all-zero parent and a height past the tip NotFoundError", async () => {
    const urls = stubApi((url) =>
      url.pathname === "/api/blocks/0/0"
        ? {
            data: [
              {
                hash: GENESIS,
                height: 0,
                timestamp: 1_231_006_505,
                difficulty: 1,
                size: 285,
                numTxs: 1,
                isFinal: true,
              },
            ],
          }
        : { data: [] },
    );
    const provider = new ECash();

    await expect(provider.getBlockInfo(0)).resolves.toMatchObject({
      number: 0,
      hash: GENESIS,
      parentHash: "0".repeat(64),
      txCount: 1,
    });
    await expect(provider.getBlockInfo(99_999_999)).rejects.toBeInstanceOf(NotFoundError);
    await expect(provider.getBlockInfo(-1)).rejects.toThrow("Invalid eCash block height");
    expect(urls.map((url) => url.pathname)).toEqual([
      "/api/blocks/0/0",
      "/api/blocks/99999998/99999999",
    ]);
  });
});
