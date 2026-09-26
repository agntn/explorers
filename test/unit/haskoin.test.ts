import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  ExplorerError,
  HTTPError,
  NotFoundError,
  UnsupportedChainError,
} from "../../src/core/errors.ts";
import { create } from "../../src/core/registry.ts";
import { Haskoin } from "../../src/providers/haskoin.ts";

const BASE = "https://api.haskoin.com/bch";
const PUZZLE = "bitcoincash:qz3yjg59ypg6jqpwhaxgvjj44jm4hdx0w5wsxw2qez";
const FUNDER = "bitcoincash:qzcnx0z2l9ncs7el5fcwgufv4mrng605ngc8p5csqn";
const MINER = "bitcoincash:qz5zzdx2l6ud0extau5r9v2vd7h9u7m57g93q42p8z";
const PAYER = "bitcoincash:qpcat33qmd2s08qvgmeeyfhu52e9qj84r5y4e599m8";
const PAYEE = "bitcoincash:qq72qmmuw9765trw8clhf9y9jd6e3uwj6vj9e53ttd";
const FUNDING = "5297c8e93161f2d000d5b4f7bdef45d22eb77a0e697f842e798960883dc07914";
const SWEEP = "3b32d20abbe7c1444eddb3fc581feb78ac9506b5d293202f94ce1be66cc172a9";
const COINBASE = "8608b1b1c20861a264e9988bfd26d585fb022a6a37e194f651b6cd4b7f3a6e3a";
const PENDING = "5e16dc43aadaba12ef52882ea4e66d1d1a0f2efc57b162646d3e5f0b3abb6eec";
const BLOCK = "0000000000000000005db098625d01f84f64f1f96787bbce283eb7b9be146723";

/* Mainnet transactions from api.haskoin.com/bch with scripts and witnesses dropped. The puzzle
   address received 7319 satoshis in 5297c8e9… and swept them to its funder in 3b32d20a…, which
   also carries an OP_RETURN output. */
const funding = {
  txid: FUNDING,
  fee: 192,
  inputs: [{ coinbase: false, txid: "f".repeat(64), output: 1, value: 7511, address: FUNDER }],
  outputs: [{ address: PUZZLE, value: 7319, spent: true }],
  block: { height: 910_538, position: 23 },
  deleted: false,
  time: 1_754_533_500,
};

const sweep = {
  txid: SWEEP,
  fee: 238,
  inputs: [{ coinbase: false, txid: FUNDING, output: 0, value: 7319, address: PUZZLE }],
  outputs: [
    { address: null, value: 0, spent: false },
    { address: FUNDER, value: 7081, spent: true },
  ],
  block: { height: 910_538, position: 16 },
  deleted: false,
  time: 1_754_533_500,
};

const coinbase = {
  txid: COINBASE,
  fee: 0,
  inputs: [
    { coinbase: true, txid: "0".repeat(64), output: 4_294_967_295, value: null, address: null },
  ],
  outputs: [{ address: MINER, value: 312_628_763, spent: true }],
  block: { height: 910_538, position: 0 },
  deleted: false,
  time: 1_754_533_500,
};

const pending = {
  txid: PENDING,
  fee: 226,
  inputs: [
    { coinbase: false, txid: "2".repeat(64), output: 0, value: 214_664_000, address: PAYER },
  ],
  outputs: [
    { address: PAYEE, value: 1_500_000, spent: false },
    { address: PAYER, value: 213_163_774, spent: false },
  ],
  block: { mempool: 1_790_439_221 },
  deleted: false,
  time: 1_790_439_221,
};

const NOT_FOUND = {
  error: "not-found-or-invalid-arg",
  message: "Item not found or argument invalid",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/* Answer every request through `route` and keep the URLs asked for, in order. */
function stubApi(route: (url: URL) => unknown): URL[] {
  const urls: URL[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: string | URL | Request) => {
      const url = new URL(request instanceof Request ? request.url : String(request));
      urls.push(url);
      const answer = route(url);
      return answer instanceof Response ? answer : jsonResponse(answer);
    }),
  );
  return urls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("haskoin provider", () => {
  it("reports the operations Haskoin serves", async () => {
    const provider = await create("haskoin");

    expect(provider.capabilities).toEqual({
      balances: true,
      txHistory: true,
      txDetail: true,
      utxos: true,
      contractInfo: false,
      tokenBalances: false,
      tokenTransfers: false,
      gasData: false,
      blockInfo: true,
    });
    expect(provider.getGasData).toBeUndefined();
    expect(provider.getTokenBalances).toBeUndefined();
  });

  it("reads the balance, the totals and the unspent mempool outputs", async () => {
    const urls = stubApi(() => ({
      address: PUZZLE,
      confirmed: 1000,
      unconfirmed: 250,
      utxo: 2,
      txs: 16,
      received: 259_007_180,
    }));
    const provider = await create("haskoin");

    await expect(provider.getBalance(PUZZLE, "bitcoincash")).resolves.toMatchObject({
      address: PUZZLE,
      chain: "bitcoincash",
      balance: "1000",
      balanceFormatted: "0.00001",
      funded: "259007180",
      spent: "259005930",
      unconfirmed: "250",
      symbol: "BCH",
      blockNumber: null,
      blockHash: null,
    });
    expect(urls[0]!.href).toBe(`${BASE}/address/${encodeURIComponent(PUZZLE)}/balance`);
  });

  it("asks for a CashAddr written without the prefix or in capitals in the prefixed form", async () => {
    const urls = stubApi(() => ({ confirmed: 0, unconfirmed: 0, received: 0 }));
    const provider = await create("haskoin");

    await provider.getBalance(PUZZLE.slice("bitcoincash:".length));
    await provider.getBalance(PUZZLE.toUpperCase());
    expect(urls.map((url) => url.pathname)).toEqual([
      `/bch/address/${encodeURIComponent(PUZZLE)}/balance`,
      `/bch/address/${encodeURIComponent(PUZZLE)}/balance`,
    ]);
  });

  it("constructs without a config and takes another Haskoin root", async () => {
    const urls = stubApi(() => ({ confirmed: 0, unconfirmed: 0, received: 0 }));

    await new Haskoin({ baseUrl: "https://haskoin.example/bch/" }).getBalance(PUZZLE);
    expect(urls[0]!.href).toBe(
      `https://haskoin.example/bch/address/${encodeURIComponent(PUZZLE)}/balance`,
    );
    expect(new Haskoin().name).toBe("haskoin");
  });

  it("rejects another chain, a legacy address and a malformed hash before any request", async () => {
    const urls = stubApi(() => ({}));
    const provider = await create("haskoin");

    await expect(provider.getBalance(PUZZLE, "bitcoin")).rejects.toBeInstanceOf(
      UnsupportedChainError,
    );
    await expect(provider.getBalance("1FeexV6bAHb8ybZjqQMjJrcCrHGW9sb6uF")).rejects.toThrow(
      "Invalid Bitcoin Cash address, expected CashAddr",
    );
    await expect(provider.getTxDetail?.("abc")).rejects.toThrow(
      "Invalid Bitcoin Cash transaction hash",
    );
    expect(urls).toEqual([]);
  });

  it("reads each side of a transaction from its own address", async () => {
    const urls = stubApi(() => [sweep, funding]);
    const provider = await create("haskoin");

    const [sent, received] = await provider.getTxHistory(PUZZLE.slice("bitcoincash:".length));
    expect(sent).toMatchObject({
      hash: SWEEP,
      blockNumber: 910_538,
      timestamp: "2025-08-07T02:25:00.000Z",
      from: PUZZLE,
      to: FUNDER,
      value: "7081",
      valueFormatted: "0.00007081",
      fee: "238",
      status: "success",
    });
    expect(received).toMatchObject({
      hash: FUNDING,
      from: FUNDER,
      to: PUZZLE,
      value: "7319",
      fee: "192",
    });
    expect(urls[0]!.pathname).toBe(`/bch/address/${encodeURIComponent(PUZZLE)}/transactions/full`);
  });

  it("reads a transaction without an address from its first payment and skips OP_RETURN", async () => {
    const urls = stubApi(() => sweep);
    const provider = await create("haskoin");

    await expect(provider.getTxDetail?.(SWEEP.toUpperCase())).resolves.toMatchObject({
      hash: SWEEP,
      from: PUZZLE,
      to: FUNDER,
      value: "7081",
      fee: "238",
    });
    expect(urls[0]!.pathname).toBe(`/bch/transaction/${SWEEP}`);
  });

  it("reads a block reward with no sender", async () => {
    stubApi(() => coinbase);
    const provider = await create("haskoin");

    await expect(provider.getTxDetail?.(COINBASE)).resolves.toMatchObject({
      from: "",
      to: MINER,
      value: "312628763",
      fee: "0",
    });
  });

  it("marks a mempool transaction pending at block zero and a deleted one failed", async () => {
    let answer: unknown = pending;
    stubApi(() => answer);
    const provider = await create("haskoin");

    const mempool = await provider.getTxDetail?.(PENDING);
    expect(mempool).toMatchObject({ blockNumber: 0, status: "pending", to: PAYEE });
    expect(mempool?.timestamp).toBeUndefined();

    answer = { ...funding, deleted: true };
    await expect(provider.getTxDetail?.(FUNDING)).resolves.toMatchObject({ status: "failed" });
  });

  it("answers a missing transaction or address with NotFoundError naming it", async () => {
    stubApi(() => jsonResponse(NOT_FOUND, 404));
    const provider = await create("haskoin");

    const missing = provider.getTxDetail?.("0".repeat(64));
    await expect(missing).rejects.toBeInstanceOf(NotFoundError);
    await expect(missing).rejects.toThrow(`Not found: Transaction ${"0".repeat(64)}`);
    await expect(provider.getBalance(PUZZLE)).rejects.toThrow(`Not found: Address ${PUZZLE}`);
  });

  it("passes on the reason of a 400 and keeps a 400 without one as HTTPError", async () => {
    let body: unknown = { error: "user-error", message: "offset exceeded: 50001 > 50000" };
    stubApi(() => jsonResponse(body, 400));
    const provider = await create("haskoin");

    const failure = provider.getBalance(PUZZLE);
    await expect(failure).rejects.toBeInstanceOf(ExplorerError);
    await expect(failure).rejects.toThrow("Haskoin: offset exceeded: 50001 > 50000");

    body = "<html>Bad Request</html>";
    await expect(provider.getBalance(PUZZLE)).rejects.toBeInstanceOf(HTTPError);
  });

  it("turns a page into an offset and an end block into a height", async () => {
    const urls = stubApi(() => [funding]);
    const provider = await create("haskoin");

    await expect(
      provider.getTxHistory(PUZZLE, "bitcoincash", { page: 3, limit: 5, endBlock: 910_500 }),
    ).resolves.toHaveLength(1);
    expect(Object.fromEntries(urls[0]!.searchParams)).toEqual({
      limit: "5",
      offset: "10",
      height: "910500",
    });
  });

  it("rejects what Haskoin cannot list before any request", async () => {
    const urls = stubApi(() => []);
    const provider = await create("haskoin");

    await expect(provider.getTxHistory(PUZZLE, "bitcoincash", { sort: "asc" })).rejects.toThrow(
      "Haskoin lists history newest first only",
    );
    await expect(
      provider.getTxHistory(PUZZLE, "bitcoincash", { startBlock: 900_000 }),
    ).rejects.toThrow("Haskoin history takes an end block only");
    await expect(provider.getTxHistory(PUZZLE, "bitcoincash", { endBlock: -1 })).rejects.toThrow(
      "Invalid Bitcoin Cash end block",
    );
    await expect(provider.getTxHistory(PUZZLE, "bitcoincash", { page: 0 })).rejects.toThrow(
      "Haskoin history pages start at 1",
    );
    await expect(
      provider.getTxHistory(PUZZLE, "bitcoincash", { page: 502, limit: 100 }),
    ).rejects.toThrow("Haskoin skips at most 50000 transactions");
    expect(urls).toEqual([]);

    await provider.getTxHistory(PUZZLE, "bitcoincash", { page: 501, limit: 100 });
    expect(urls[0]!.searchParams.get("offset")).toBe("50000");
  });

  it("lists unspent outputs page by page and keeps a mempool one out of any block", async () => {
    const confirmed = {
      address: PUZZLE,
      block: { height: 944_127, position: 62 },
      txid: "55107734aa4328688eafa228c5ff2c1b6319d8e69ebc5c589f16b515c52556d2",
      index: 0,
      pkscript: "76a914",
      value: 1_283_465,
    };
    const unconfirmed = { ...confirmed, block: { mempool: 1_790_439_221 }, index: 1, value: 546 };
    const urls = stubApi((url) =>
      url.searchParams.get("offset") === "0"
        ? Array.from({ length: 1000 }, () => confirmed)
        : [unconfirmed],
    );
    const provider = await create("haskoin");

    const utxos = await provider.getUtxos?.(PUZZLE);
    expect(utxos).toHaveLength(1001);
    expect(utxos?.[0]).toEqual({
      txid: confirmed.txid,
      vout: 0,
      value: "1283465",
      valueFormatted: "0.01283465",
      confirmed: true,
      blockNumber: 944_127,
      blockHash: null,
    });
    expect(utxos?.[1000]).toMatchObject({ vout: 1, confirmed: false, blockNumber: null });
    expect(urls.map((url) => url.searchParams.get("offset"))).toEqual(["0", "1000"]);
  });

  it("stops listing unspent outputs after ten pages", async () => {
    const output = {
      block: { height: 944_127, position: 62 },
      txid: "5".repeat(64),
      index: 0,
      value: 546,
    };
    const urls = stubApi(() => Array.from({ length: 1000 }, () => output));
    const provider = await create("haskoin");

    await expect(provider.getUtxos?.(PUZZLE)).resolves.toHaveLength(10_000);
    expect(urls).toHaveLength(10);
  });

  it("reads the main-chain block at a height and counts its transactions", async () => {
    const block = {
      hash: BLOCK,
      height: 910_538,
      mainchain: true,
      previous: "000000000000000000c216c1b37f3800dad14b7931be61fac349d1a48b2e10f3",
      time: 1_754_533_500,
      tx: [COINBASE, SWEEP, FUNDING],
      work: "761659098095396029184283231",
    };
    const urls = stubApi(() => [{ ...block, hash: "1".repeat(64), mainchain: false }, block]);
    const provider = await create("haskoin");

    await expect(provider.getBlockInfo?.(910_538)).resolves.toEqual({
      number: 910_538,
      hash: BLOCK,
      parentHash: block.previous,
      timestamp: "2025-08-07T02:25:00.000Z",
      miner: "",
      gasUsed: "0",
      gasLimit: "0",
      txCount: 3,
    });
    expect(urls[0]!.href).toBe(`${BASE}/block/height/910538`);
  });

  it("answers a height past the tip with NotFoundError", async () => {
    stubApi(() => []);
    const provider = await create("haskoin");

    await expect(provider.getBlockInfo?.(99_999_999)).rejects.toBeInstanceOf(NotFoundError);
    await expect(provider.getBlockInfo?.(-1)).rejects.toThrow("Invalid Bitcoin Cash block height");
  });
});
