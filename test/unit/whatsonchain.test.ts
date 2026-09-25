import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { ExplorerError, NotFoundError, UnsupportedChainError } from "../../src/core/errors.ts";
import { create } from "../../src/core/registry.ts";
import { WhatsOnChain } from "../../src/providers/whatsonchain.ts";

const BASE = "https://api.whatsonchain.com/v1/bsv/main";
const RECIPIENT = "1FeexV6bAHb8ybZjqQMjJrcCrHGW9sb6uF";
const SENDER = "1ALemocKgcQD6trbrwuDnwbT74J9JNAiwC";
const CHILD = "8b334f90f231fd0a666c68f491ff59b0492122daec8d23302925befe11e3e981";
const PARENT = "5744a5ad4f017d64475281a52410dd5b0800581be4f485bc6c5d63dbfb2c76b1";
const GRANDPARENT = "3404383d4231a9f2" + "0".repeat(48);

function payTo(address: string, value: number, n: number) {
  return {
    value,
    n,
    scriptPubKey: { hex: "76a914", type: "pubkeyhash", addresses: [address], isTruncated: false },
  };
}

function dataOutput(n: number) {
  return { value: 0, n, scriptPubKey: { hex: "006a4d0f0b53", type: "nulldata" } };
}

/* Mainnet transactions 8b334f90… and its parent 5744a5ad…, scripts shortened. */
const child = {
  txid: CHILD,
  hash: CHILD,
  vin: [{ coinbase: "", txid: PARENT, vout: 2, sequence: 4_294_967_295 }],
  vout: [payTo(RECIPIENT, 0.0001, 0), dataOutput(1), payTo(SENDER, 0.00014819, 2)],
  blockhash: "b".repeat(64),
  confirmations: 41_902,
  time: 1_765_099_157,
  blocktime: 1_765_099_157,
  blockheight: 926_389,
};

const parent = {
  txid: PARENT,
  hash: PARENT,
  vin: [{ coinbase: "", txid: GRANDPARENT, vout: 2, sequence: 4_294_967_295 }],
  vout: [payTo(RECIPIENT, 9.998e-5, 0), dataOutput(1), payTo(SENDER, 0.00026356, 2)],
  blockhash: "c".repeat(64),
  confirmations: 41_903,
  time: 1_765_098_677,
  blocktime: 1_765_098_677,
  blockheight: 926_388,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type Route = (url: URL, body: unknown) => unknown;

function stubApi(route: Route) {
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    const answer = route(url, body);
    return answer instanceof Response ? answer : jsonResponse(answer);
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

/* `POST /txs` answers only for the txids it knows, the way the live endpoint drops unknown ones. */
function bulk(known: readonly string[]) {
  const byTxid = new Map([child, parent].map((tx) => [tx.txid, tx]));
  return (body: unknown) => {
    const { txids } = body as { readonly txids: readonly string[] };
    return txids.filter((txid) => known.includes(txid)).map((txid) => byTxid.get(txid));
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("whatsonchain provider", () => {
  it("reports the operations WhatsOnChain serves", async () => {
    const provider = await create("whatsonchain");

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

  it("reads the confirmed balance and the signed mempool delta", async () => {
    const fetch = stubApi((url) =>
      url.pathname.endsWith("/confirmed/balance")
        ? { address: RECIPIENT, script: "3eb8", confirmed: 7_995_818_934_401, error: "" }
        : { address: RECIPIENT, script: "3eb8", unconfirmed: -1537, error: "" },
    );
    const provider = await create("whatsonchain");

    await expect(provider.getBalance(RECIPIENT, "bitcoinsv")).resolves.toMatchObject({
      address: RECIPIENT,
      chain: "bitcoinsv",
      balance: "7995818934401",
      balanceFormatted: "79958.18934401",
      unconfirmed: "-1537",
      symbol: "BSV",
      blockNumber: null,
      blockHash: null,
    });
    expect(fetch.mock.calls.map(([url]) => String(url)).sort()).toEqual([
      `${BASE}/address/${RECIPIENT}/confirmed/balance`,
      `${BASE}/address/${RECIPIENT}/unconfirmed/balance`,
    ]);
  });

  it("constructs without a config, as the subpath import is documented", async () => {
    const fetch = stubApi(() => ({ confirmed: 0, unconfirmed: 0, error: "" }));

    await new WhatsOnChain().getBalance(RECIPIENT);
    expect(String(fetch.mock.calls[0]?.[0]).startsWith(`${BASE}/address/`)).toBe(true);
  });

  it("sends the API key in the Authorization header", async () => {
    vi.stubEnv("WHATSONCHAIN_API_KEY", "mainnet_test");
    const fetch = stubApi(() => ({ confirmed: 0, unconfirmed: 0, error: "" }));
    const provider = await create("whatsonchain");

    await provider.getBalance(RECIPIENT);
    const headers = new Headers(fetch.mock.calls[0]?.[1]?.headers);
    expect(headers.get("authorization")).toBe("mainnet_test");
  });

  it("rejects another chain and a malformed address before any request", async () => {
    const fetch = stubApi(() => {
      throw new Error("unexpected request");
    });
    const provider = await create("whatsonchain");

    await expect(provider.getBalance(RECIPIENT, "bitcoin")).rejects.toBeInstanceOf(
      UnsupportedChainError,
    );
    await expect(provider.getBalance("3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy")).rejects.toThrow(
      "Invalid Bitcoin SV address",
    );
    await expect(provider.getTxDetail?.("not-a-hash")).rejects.toThrow(
      "Invalid Bitcoin SV transaction hash",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("prices a transaction from the parent it spends", async () => {
    const fetch = stubApi((url, body) =>
      url.pathname.endsWith("/txs") ? bulk([PARENT])(body) : child,
    );
    const provider = await create("whatsonchain");

    const tx = await provider.getTxDetail?.(CHILD);
    expect(tx).toMatchObject({
      hash: CHILD,
      blockNumber: 926_389,
      timestamp: "2025-12-07T09:19:17.000Z",
      from: SENDER,
      to: RECIPIENT,
      value: "10000",
      valueFormatted: "0.0001",
      fee: "1537",
      status: "success",
      isContractInteraction: false,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toEqual({ txids: [PARENT] });
  });

  it("leaves the fee and the sender unknown when the parent is missing", async () => {
    stubApi((url, body) => (url.pathname.endsWith("/txs") ? bulk([])(body) : child));
    const provider = await create("whatsonchain");

    const tx = await provider.getTxDetail?.(CHILD);
    expect(tx?.fee).toBeUndefined();
    expect(tx?.from).toBe("");
    expect(tx?.value).toBe("10000");
  });

  it("reads a block reward with the empty txid WhatsOnChain gives its coinbase input", async () => {
    const reward = {
      ...child,
      vin: [{ coinbase: "0340c50e2f53413130302f", txid: "", vout: 0, sequence: 4_294_967_295 }],
      vout: [payTo(SENDER, 3.13888557, 0)],
    };
    const fetch = stubApi(() => reward);
    const provider = await create("whatsonchain");

    await expect(provider.getTxDetail?.(CHILD)).resolves.toMatchObject({
      from: "",
      to: SENDER,
      value: "313888557",
      fee: "0",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("answers a missing transaction with NotFoundError", async () => {
    stubApi(() => jsonResponse(null, 404));
    const provider = await create("whatsonchain");

    await expect(provider.getTxDetail?.("0".repeat(64))).rejects.toBeInstanceOf(NotFoundError);
  });

  it("reads each side of a transaction from its own address", async () => {
    const history = (address: string) => ({
      address,
      script: "3eb8",
      result: [{ tx_hash: CHILD, height: 926_389 }],
      error: "",
    });
    stubApi((url, body) => {
      if (url.pathname.endsWith("/txs")) return bulk([CHILD, PARENT])(body);
      return history(url.pathname.split("/")[5] ?? "");
    });
    const provider = await create("whatsonchain");

    const [received] = await provider.getTxHistory(RECIPIENT);
    expect(received).toMatchObject({ from: SENDER, to: RECIPIENT, value: "10000", fee: "1537" });

    const [sent] = await provider.getTxHistory(SENDER);
    expect(sent).toMatchObject({ from: SENDER, to: RECIPIENT, value: "10000", fee: "1537" });
  });

  it("orders a history page the way it was asked for and walks tokens to reach a page", async () => {
    const fetch = stubApi((url, body) => {
      if (url.pathname.endsWith("/txs")) return bulk([CHILD, PARENT])(body);
      const second = url.searchParams.get("token") === "next";
      // WhatsOnChain lists the newest rows of a descending page oldest first.
      return {
        result: second
          ? [
              { tx_hash: PARENT, height: 926_388 },
              { tx_hash: CHILD, height: 926_389 },
            ]
          : [],
        nextPageToken: second ? undefined : "next",
        error: "",
      };
    });
    const provider = await create("whatsonchain");

    const page = await provider.getTxHistory(RECIPIENT, "bitcoinsv", { limit: 2, page: 2 });
    expect(page.map((tx) => tx.hash)).toEqual([CHILD, PARENT]);
    expect(page[1]).toMatchObject({ value: "9998", valueFormatted: "0.00009998" });
    const historyUrls = fetch.mock.calls
      .map(([url]) => new URL(String(url)))
      .filter((url) => url.pathname.endsWith("/confirmed/history"));
    expect(historyUrls.map((url) => url.search)).toEqual([
      "?limit=2&order=desc",
      "?limit=2&order=desc&token=next",
    ]);
  });

  it("reverses a page, so transactions of one block keep the requested order too", async () => {
    stubApi((url, body) => {
      if (url.pathname.endsWith("/txs")) return bulk([CHILD, PARENT])(body);
      // The live endpoint answers `order=asc` with the exact reverse of `order=desc`.
      const rows = [
        { tx_hash: PARENT, height: 926_389 },
        { tx_hash: CHILD, height: 926_389 },
      ];
      return { result: url.searchParams.get("order") === "asc" ? rows : [...rows].reverse() };
    });
    const provider = await create("whatsonchain");

    const newest = await provider.getTxHistory(RECIPIENT, "bitcoinsv", { sort: "desc" });
    const oldest = await provider.getTxHistory(RECIPIENT, "bitcoinsv", { sort: "asc" });
    expect(newest.map((tx) => tx.hash)).toEqual([PARENT, CHILD]);
    expect(oldest.map((tx) => tx.hash)).toEqual([CHILD, PARENT]);
  });

  it("returns an empty page past the end of the history", async () => {
    const fetch = stubApi(() => ({ result: [], error: "" }));
    const provider = await create("whatsonchain");

    await expect(provider.getTxHistory(RECIPIENT, "bitcoinsv", { page: 3 })).resolves.toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects block bounds and pages it cannot reach", async () => {
    const fetch = stubApi(() => ({ result: [], error: "" }));
    const provider = await create("whatsonchain");

    await expect(provider.getTxHistory(RECIPIENT, "bitcoinsv", { startBlock: 1 })).rejects.toThrow(
      "WhatsOnChain history takes no block bounds",
    );
    await expect(provider.getTxHistory(RECIPIENT, "bitcoinsv", { page: 11 })).rejects.toThrow(
      "WhatsOnChain history reaches page 10",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("stops resolving parents after 200 of them", async () => {
    const inputs = Array.from({ length: 250 }, (_, index) => ({
      coinbase: "",
      txid: index.toString(16).padStart(64, "0"),
      vout: 0,
    }));
    const posts: string[][] = [];
    stubApi((url, body) => {
      if (url.pathname.endsWith("/txs")) {
        posts.push((body as { txids: string[] }).txids);
        return [];
      }
      return { ...child, vin: inputs };
    });
    const provider = await create("whatsonchain");

    const tx = await provider.getTxDetail?.(CHILD);
    expect(posts).toHaveLength(10);
    expect(posts.every((txids) => txids.length === 20)).toBe(true);
    expect(tx?.fee).toBeUndefined();
  });

  it("surfaces an error WhatsOnChain reports inside a 200 response", async () => {
    stubApi(() => ({ result: [], error: "address history unavailable" }));
    const provider = await create("whatsonchain");

    await expect(provider.getTxHistory(RECIPIENT)).rejects.toThrow(
      new ExplorerError("WhatsOnChain: address history unavailable", "whatsonchain"),
    );
  });

  it("lists spendable outputs across pages and drops the ones a mempool spend claims", async () => {
    const outputs = [
      {
        height: 946_250,
        tx_pos: 0,
        tx_hash: "f2c9c870a9b0d083c484641144c58726cb0ccdaf3557f61fa7f7e00fba50994a",
        value: 1_693_477,
        isSpentInMempoolTx: false,
        status: "confirmed",
      },
      {
        height: 954_253,
        tx_pos: 1,
        tx_hash: "e4584403f958501ba6603e6895f818333a842538b0061bbda6b4438044583bce",
        value: 1,
        isSpentInMempoolTx: true,
        status: "confirmed",
      },
    ];
    const pending = { height: 0, tx_pos: 3, tx_hash: CHILD, value: 500, status: "unconfirmed" };
    const fetch = stubApi((url) =>
      url.searchParams.get("token") === "next"
        ? { result: [pending], error: "" }
        : { result: outputs, nextPageToken: "next", error: "" },
    );
    const provider = await create("whatsonchain");

    await expect(provider.getUtxos?.(RECIPIENT)).resolves.toEqual([
      {
        txid: outputs[0]?.tx_hash,
        vout: 0,
        value: "1693477",
        valueFormatted: "0.01693477",
        confirmed: true,
        blockNumber: 946_250,
        blockHash: null,
      },
      {
        txid: CHILD,
        vout: 3,
        value: "500",
        valueFormatted: "0.000005",
        confirmed: false,
        blockNumber: null,
        blockHash: null,
      },
    ]);
    expect(String(fetch.mock.calls[0]?.[0])).toBe(`${BASE}/address/${RECIPIENT}/unspent/all`);
  });

  it("reads a block by height", async () => {
    const fetch = stubApi(() => ({
      hash: "00000000000000001ee77650522c955ba4bf8ff143c3428935a9c0c689631549",
      height: 968_000,
      txcount: 6993,
      time: 1_790_153_259,
      previousblockhash: "00000000000000001daf9b1dc24e33b2ecca5793dedb66bb693006ba235b6c41",
      miner: "SA100",
    }));
    const provider = await create("whatsonchain");

    await expect(provider.getBlockInfo?.(968_000)).resolves.toEqual({
      number: 968_000,
      hash: "00000000000000001ee77650522c955ba4bf8ff143c3428935a9c0c689631549",
      parentHash: "00000000000000001daf9b1dc24e33b2ecca5793dedb66bb693006ba235b6c41",
      timestamp: "2026-09-23T08:47:39.000Z",
      miner: "",
      gasUsed: "0",
      gasLimit: "0",
      txCount: 6993,
    });
    expect(String(fetch.mock.calls[0]?.[0])).toBe(`${BASE}/block/height/968000`);
  });
});
