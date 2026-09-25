import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  ExplorerError,
  HTTPError,
  NotFoundError,
  UnsupportedChainError,
} from "../../src/core/errors.ts";
import { create } from "../../src/core/registry.ts";
import { Blockbook } from "../../src/providers/blockbook.ts";

const BASE = "https://btgexplorer.com/api/v2";
const POOL = "GNiT8AiCaMYPYW9uSgmq2qUsVjNgh1kdty";
const MINER = "GJjz2Du9BoJQ3CPcoyVTHUJZSj62i1693U";
const CO_SIGNER = "GexSPkVSXTZSCdFnAXoeWK3YXJ6LpDBhrE";
const PAYEE = "Ga41hPwBfbNa2fMvgNQNhRTuK2QHdrie3M";
const CHANGE = "GLPKQ5x7qSA2wLmAamYCyFEYxuCYVEuUo4";
const PAYOUT = "a893726bf637fdc1f04dc8f1adb6b0e06b22c1f4bfbd39bb359eedadf2476c4e";
const SPEND = "b4568c124fef82032d68154401b0a9868527ada83524a2dd62174c846bd9241d";
const COINBASE = "d966a5cac45ff3781c79f2cc73492eb6907ad6fb30a7070698994151ba7a75b1";
const BLOCK = "0000006c844f623256e28d204fa91594d3a96b05f7526a98b1f7cbefb0d39418";

function input(address: string, value: string) {
  return { txid: "e".repeat(64), n: 0, addresses: [address], isAddress: true, value };
}

function output(address: string, value: string, n: number) {
  return { value, n, hex: "76a914", addresses: [address], isAddress: true };
}

/* Mainnet transactions from btgexplorer.com with scripts dropped. The pool payout a893726b… keeps
   two of its 6 inputs and 38 outputs, the spend b4568c12… three of its 13 inputs, so their totals
   no longer add up to the fee. */
const payout = {
  txid: PAYOUT,
  vin: [input(MINER, "312500000"), input(MINER, "312502161")],
  vout: [output("GcWXhht6a4KhE1A3dKvVjUfK9CXbDR598q", "11122028", 0), output(POOL, "14525147", 32)],
  blockHash: "0".repeat(64),
  blockHeight: 966_061,
  confirmations: 2,
  blockTime: 1_790_326_702,
  fees: "21031",
};

const spend = {
  txid: SPEND,
  vin: [input(CO_SIGNER, "10026250"), input(POOL, "10240311"), input(POOL, "13890929")],
  vout: [output(PAYEE, "159378793", 0), output(CHANGE, "8533102", 1)],
  blockHash: BLOCK,
  blockHeight: 966_000,
  confirmations: 63,
  blockTime: 1_790_287_458,
  fees: "19277",
};

const coinbase = {
  txid: COINBASE,
  vin: [{ n: 0, isAddress: false, coinbase: "0370bd0e00" }],
  vout: [
    output(MINER, "312519277", 0),
    {
      value: "0",
      n: 1,
      hex: "6a24aa21a9ed",
      addresses: ["OP_RETURN aa21a9ed"],
      isAddress: false,
    },
  ],
  blockHash: BLOCK,
  blockHeight: 966_000,
  confirmations: 63,
  blockTime: 1_790_287_458,
  fees: "0",
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

function addressPage(page: number, transactions: readonly unknown[]) {
  return {
    page,
    totalPages: 1426,
    itemsOnPage: transactions.length,
    address: POOL,
    balance: "53367161",
    totalReceived: "26621747133",
    totalSent: "26568379972",
    unconfirmedBalance: "0",
    unconfirmedTxs: 0,
    txs: 2852,
    transactions,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("blockbook provider", () => {
  it("reports the operations Blockbook serves", async () => {
    const provider = await create("blockbook");

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

  it("reads the confirmed balance, the totals and the signed mempool delta", async () => {
    const urls = stubApi(() => ({ ...addressPage(1, []), unconfirmedBalance: "-19277" }));
    const provider = await create("blockbook");

    await expect(provider.getBalance(POOL, "bitcoingold")).resolves.toMatchObject({
      address: POOL,
      chain: "bitcoingold",
      balance: "53367161",
      balanceFormatted: "0.53367161",
      funded: "26621747133",
      spent: "26568379972",
      unconfirmed: "-19277",
      symbol: "BTG",
      blockNumber: null,
      blockHash: null,
    });
    expect(urls[0]!.href).toBe(`${BASE}/address/${POOL}?details=basic`);
  });

  it("constructs without a config and takes another Blockbook root", async () => {
    const urls = stubApi(() => addressPage(1, []));

    await new Blockbook({ baseUrl: "https://blockbook.example/" }).getBalance(POOL);
    expect(urls[0]!.href).toBe(`https://blockbook.example/api/v2/address/${POOL}?details=basic`);
    expect(new Blockbook().name).toBe("blockbook");
  });

  it("rejects another chain and a malformed address before any request", async () => {
    const urls = stubApi(() => ({}));
    const provider = await create("blockbook");

    await expect(provider.getBalance(POOL, "bitcoin")).rejects.toBeInstanceOf(
      UnsupportedChainError,
    );
    await expect(provider.getBalance("1BoatSLRHtKNngkdXEeobR76b53LETtpyT")).rejects.toThrow(
      "Invalid Bitcoin Gold address",
    );
    await expect(provider.getTxDetail?.("abc")).rejects.toThrow(
      "Invalid Bitcoin Gold transaction hash",
    );
    expect(urls).toEqual([]);
  });

  it("reads each side of a transaction from its own address", async () => {
    const urls = stubApi(() => addressPage(1, [payout, spend]));
    const provider = await create("blockbook");

    const [received, sent] = await provider.getTxHistory(POOL, "bitcoingold", { limit: 2 });

    expect(urls[0]!.searchParams.get("details")).toBe("txs");
    expect(urls[0]!.searchParams.get("pageSize")).toBe("2");
    expect(received).toMatchObject({
      hash: PAYOUT,
      blockNumber: 966_061,
      timestamp: "2026-09-25T08:58:22.000Z",
      from: MINER,
      to: POOL,
      value: "14525147",
      valueFormatted: "0.14525147",
      fee: "21031",
      status: "success",
    });
    expect(sent).toMatchObject({
      hash: SPEND,
      from: POOL,
      to: PAYEE,
      value: "167911895",
      fee: "19277",
    });
  });

  it("reads a transaction without an address from its first payment", async () => {
    stubApi(() => spend);
    const provider = await create("blockbook");

    await expect(provider.getTxDetail?.(SPEND)).resolves.toMatchObject({
      hash: SPEND,
      blockNumber: 966_000,
      from: CO_SIGNER,
      to: PAYEE,
      value: "159378793",
      valueFormatted: "1.59378793",
      fee: "19277",
      isContractInteraction: false,
      tokenTransfers: [],
    });
  });

  it("reads a block reward with no sender and skips the OP_RETURN output", async () => {
    stubApi(() => coinbase);
    const provider = await create("blockbook");

    await expect(provider.getTxDetail?.(COINBASE)).resolves.toMatchObject({
      from: "",
      to: MINER,
      value: "312519277",
      fee: "0",
    });
  });

  it("marks a mempool transaction pending at block zero", async () => {
    stubApi(() => ({ ...payout, blockHeight: -1, confirmations: 0, blockTime: 1_790_326_000 }));
    const provider = await create("blockbook");

    await expect(provider.getTxDetail?.(PAYOUT)).resolves.toMatchObject({
      blockNumber: 0,
      status: "pending",
      timestamp: "2026-09-25T08:46:40.000Z",
    });
  });

  it("answers a missing transaction or block with NotFoundError", async () => {
    stubApi((url) =>
      jsonResponse(
        {
          error: url.pathname.includes("/tx/")
            ? `Transaction '${"0".repeat(64)}' not found`
            : "Block not found, Block not found",
        },
        400,
      ),
    );
    const provider = await create("blockbook");

    await expect(provider.getTxDetail?.("0".repeat(64))).rejects.toBeInstanceOf(NotFoundError);
    await expect(provider.getBlockInfo?.(99_999_999)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("passes on the reason of another 400 and keeps a 400 without one as HTTPError", async () => {
    let body: unknown = { error: "Invalid address, checksum mismatch" };
    stubApi(() => jsonResponse(body, 400));
    const provider = await create("blockbook");

    const failure = provider.getBalance(POOL);
    await expect(failure).rejects.toBeInstanceOf(ExplorerError);
    await expect(failure).rejects.toThrow("Blockbook: Invalid address, checksum mismatch");

    body = "<html>Bad Request</html>";
    await expect(provider.getBalance(POOL)).rejects.toBeInstanceOf(HTTPError);
  });

  it("asks for a page and a block range and returns nothing past the last page", async () => {
    const urls = stubApi((url) =>
      addressPage(Math.min(Number(url.searchParams.get("page")), 3), [spend]),
    );
    const provider = await create("blockbook");

    await expect(
      provider.getTxHistory(POOL, "bitcoingold", {
        page: 2,
        limit: 1,
        startBlock: 965_000,
        endBlock: 966_000,
      }),
    ).resolves.toHaveLength(1);
    expect(Object.fromEntries(urls[0]!.searchParams)).toEqual({
      details: "txs",
      page: "2",
      pageSize: "1",
      from: "965000",
      to: "966000",
    });

    // Blockbook answers a page past the end with the last one, so page 99 must not repeat page 3.
    await expect(provider.getTxHistory(POOL, "bitcoingold", { page: 99 })).resolves.toEqual([]);
  });

  it("rejects an ascending history and malformed bounds before any request", async () => {
    const urls = stubApi(() => ({}));
    const provider = await create("blockbook");

    await expect(provider.getTxHistory(POOL, "bitcoingold", { sort: "asc" })).rejects.toThrow(
      "Blockbook lists history newest first only",
    );
    await expect(provider.getTxHistory(POOL, "bitcoingold", { page: 0 })).rejects.toThrow(
      "Blockbook history pages start at 1",
    );
    await expect(provider.getTxHistory(POOL, "bitcoingold", { startBlock: -1 })).rejects.toThrow(
      "Invalid Bitcoin Gold start block",
    );
    expect(urls).toEqual([]);
  });

  it("lists unspent outputs and keeps an unconfirmed one out of any block", async () => {
    const urls = stubApi(() => [
      { txid: PAYOUT, vout: 32, value: "14525147", height: 966_061, confirmations: 2 },
      { txid: SPEND, vout: 1, value: "8533102", confirmations: 0 },
    ]);
    const provider = await create("blockbook");

    await expect(provider.getUtxos?.(POOL)).resolves.toEqual([
      {
        txid: PAYOUT,
        vout: 32,
        value: "14525147",
        valueFormatted: "0.14525147",
        confirmed: true,
        blockNumber: 966_061,
        blockHash: null,
      },
      {
        txid: SPEND,
        vout: 1,
        value: "8533102",
        valueFormatted: "0.08533102",
        confirmed: false,
        blockNumber: null,
        blockHash: null,
      },
    ]);
    expect(urls[0]!.href).toBe(`${BASE}/utxo/${POOL}`);
  });

  it("reads a block by height", async () => {
    const urls = stubApi(() => ({
      page: 1,
      totalPages: 1,
      itemsOnPage: 1000,
      hash: BLOCK,
      previousBlockHash: "0000001026bddbd3e17017ad71f32781271a1cf29949d2b5100da517ea9d90a8",
      height: 966_000,
      confirmations: 63,
      time: 1_790_287_458,
      txCount: 2,
      txs: [coinbase, spend],
    }));
    const provider = await create("blockbook");

    await expect(provider.getBlockInfo?.(966_000)).resolves.toEqual({
      number: 966_000,
      hash: BLOCK,
      parentHash: "0000001026bddbd3e17017ad71f32781271a1cf29949d2b5100da517ea9d90a8",
      timestamp: "2026-09-24T22:04:18.000Z",
      miner: "",
      gasUsed: "0",
      gasLimit: "0",
      txCount: 2,
    });
    expect(urls[0]!.href).toBe(`${BASE}/block/966000`);
  });
});
