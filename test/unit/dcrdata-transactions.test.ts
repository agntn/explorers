import { afterEach, describe, expect, it, vi } from "vitest";
import { Dcrdata } from "../../src/providers/dcrdata.js";
import { classifyInput } from "../../src/core/input.js";
import { ExplorerError } from "../../src/core/errors.js";

const ADDRESS = "Dcur2mcGjmENx4DhNqDctW5wJCVyT3Qeqkx";
const RECIPIENT = "DsX4TNPju7XRezwqYqnUEy81gB2pw96gngf";
const HASH = "4b064b5a6255ed94bb9c4347e370c5ad034db4d0550e5bd6775cbed65015ebe3";

function transaction(hash = HASH) {
  return {
    txid: hash,
    blockheight: 835438,
    confirmations: 278325,
    blocktime: 1705528622,
    fees: 0.0069772,
    vin: [{ addr: ADDRESS, valueSat: 36834727902 }],
    vout: [
      { value: 0, scriptPubKey: { type: "nulldata", hex: "6a00" } },
      { value: 0.744483, scriptPubKey: { type: "scripthash", addresses: [ADDRESS] } },
      { value: 367.59581882, scriptPubKey: { type: "pubkeyhash", addresses: [RECIPIENT] } },
    ],
  };
}

function stub(body: unknown) {
  const fetch = vi.fn(async () => new Response(JSON.stringify(body)));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => vi.unstubAllGlobals());

describe("dcrdata transactions and blocks", () => {
  it("reads details, preserves raw inputs and outputs, and classifies Decred hashes", async () => {
    const raw = transaction();
    const fetch = stub(raw);
    expect(classifyInput(HASH, "decred")).toBe("txhash");
    const tx = await new Dcrdata().getTxDetail(HASH);
    expect(tx).toMatchObject({
      hash: HASH,
      from: ADDRESS,
      to: ADDRESS,
      value: "74448300",
      valueFormatted: "0.744483",
      fee: "697720",
      status: "success",
      blockNumber: 835438,
      timestamp: "2024-01-17T21:57:02.000Z",
      raw,
    });
    expect(fetch).toHaveBeenCalledWith(
      `https://explorer.dcrdata.org/insight/api/tx/${HASH}`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it.each([1e-8, 0.00000003, 20999999.99999999])(
    "converts %s DCR without fractional atoms",
    async (amount) => {
      stub({
        ...transaction(),
        fees: amount,
        vout: [{ value: amount, scriptPubKey: { addresses: [RECIPIENT] } }],
      });
      const tx = await new Dcrdata().getTxDetail(HASH);
      expect(tx.value).toBe(
        amount === 1e-8 ? "1" : amount === 0.00000003 ? "3" : "2099999999999999",
      );
      expect(tx.fee).toBe(tx.value);
    },
  );

  it("skips addressed OP_RETURN commitments and rejects control bytes in recipients", async () => {
    const tx = transaction();
    stub({
      ...tx,
      vout: [
        { value: 0, scriptPubKey: { addresses: [ADDRESS], type: "sstxcommitment", hex: "6a00" } },
        { value: 1, scriptPubKey: { addresses: [RECIPIENT] } },
      ],
    });
    expect(await new Dcrdata().getTxDetail(HASH)).toMatchObject({
      to: RECIPIENT,
      value: "100000000",
    });
    stub({ ...tx, vout: [{ value: 1, scriptPubKey: { addresses: ["bad\nrecipient"] } }] });
    await expect(new Dcrdata().getTxDetail(HASH)).rejects.toThrow(
      "Invalid dcrdata transaction response",
    );
  });

  it("does not invent a coinbase sender or fee", async () => {
    stub({
      ...transaction(),
      isCoinBase: true,
      vin: [{ coinbase: "00", valueSat: 0 }],
      fees: undefined,
    });
    expect(await new Dcrdata().getTxDetail(HASH)).toMatchObject({ from: "", fee: "0" });
  });

  it("keeps mempool transactions pending with no fabricated timestamp or height", async () => {
    stub({ ...transaction(), confirmations: 0, blockheight: 0, blocktime: undefined });
    const tx = await new Dcrdata().getTxDetail(HASH);
    expect(tx.status).toBe("pending");
    expect(tx.blockNumber).toBe(0);
    expect(tx.timestamp).toBeUndefined();
  });

  it("does not call a negative-confirmation transaction successful", async () => {
    stub({ ...transaction(), confirmations: -1 });
    expect((await new Dcrdata().getTxDetail(HASH)).status).toBe("failed");
  });

  it("paginates history and pairs outgoing recipients with their own output value", async () => {
    const fetch = stub({
      totalItems: 10,
      from: 2,
      to: 4,
      items: [transaction(), transaction("a".repeat(64))],
    });
    const result = await new Dcrdata({ baseUrl: "https://example.test/custom/" }).getTxHistory(
      ADDRESS,
      "decred",
      { limit: 2, page: 2 },
    );
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ to: RECIPIENT, value: "36759581882" });
    expect(fetch).toHaveBeenCalledWith(
      `https://example.test/custom/addrs/${ADDRESS}/txs?from=2&to=4`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("keeps the queried address and value together for incoming history", async () => {
    const raw = transaction();
    raw.vin = [{ addr: RECIPIENT, valueSat: 36834727902 }];
    stub({ totalItems: 1, from: 0, to: 1, items: [raw] });
    expect((await new Dcrdata().getTxHistory(ADDRESS))[0]).toMatchObject({
      from: RECIPIENT,
      to: ADDRESS,
      value: "74448300",
    });
  });

  it("reads ascending pages from the end of the index, not by reversing a newest page", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        calls.push(String(input));
        return new Response(
          JSON.stringify(
            calls.length === 1
              ? { totalItems: 10, from: 0, to: 1, items: [transaction()] }
              : {
                  totalItems: 10,
                  from: 6,
                  to: 8,
                  items: [transaction("a".repeat(64)), transaction("b".repeat(64))],
                },
          ),
        );
      }),
    );
    const txs = await new Dcrdata().getTxHistory(ADDRESS, "decred", {
      sort: "asc",
      page: 2,
      limit: 2,
    });
    expect(calls[1]).toContain("?from=6&to=8");
    expect(txs.map((tx) => tx.hash)).toEqual(["b".repeat(64), "a".repeat(64)]);
  });

  it("returns empty history past the last page", async () => {
    stub({ totalItems: 0, from: 0, to: 1, items: [] });
    expect(await new Dcrdata().getTxHistory(ADDRESS, "decred", { sort: "asc" })).toEqual([]);
  });

  it("rejects a backend that ignores pagination", async () => {
    stub({ totalItems: 10, from: 0, to: 2, items: [transaction(), transaction("a".repeat(64))] });
    await expect(
      new Dcrdata().getTxHistory(ADDRESS, "decred", { page: 2, limit: 2 }),
    ).rejects.toThrow("Incomplete dcrdata history page");
  });

  it("fails an ascending read when the index total changes", async () => {
    let count = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        count++;
        return new Response(
          JSON.stringify(
            count === 1
              ? { totalItems: 2, from: 0, to: 1, items: [transaction()] }
              : { totalItems: 3, from: 1, to: 2, items: [transaction()] },
          ),
        );
      }),
    );
    await expect(
      new Dcrdata().getTxHistory(ADDRESS, "decred", { sort: "asc", limit: 1 }),
    ).rejects.toThrow("history changed");
  });

  it("reads the block array and counts both regular and stake transactions", async () => {
    const hash = "0".repeat(64);
    const fetch = stub([
      {
        hash,
        height: 1000,
        previousblockhash: "1".repeat(64),
        time: 1455209782,
        tx: [HASH, "a".repeat(64)],
        isMainChain: true,
      },
    ]);
    const block = await new Dcrdata().getBlockInfo(1000);
    expect(block).toMatchObject({
      hash,
      number: 1000,
      txCount: 2,
      miner: "",
      gasUsed: "0",
      gasLimit: "0",
      parentHash: "1".repeat(64),
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://explorer.dcrdata.org/insight/api/block/1000",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("rejects invalid inputs and unsupported block filters before I/O", async () => {
    const fetch = stub(null);
    const provider = new Dcrdata();
    await expect(provider.getTxDetail("../status")).rejects.toBeInstanceOf(ExplorerError);
    await expect(provider.getBlockInfo(-1)).rejects.toBeInstanceOf(ExplorerError);
    await expect(
      provider.getTxHistory(ADDRESS, "decred", { startBlock: 1 }),
    ).rejects.toBeInstanceOf(ExplorerError);
    await expect(provider.getTxHistory(ADDRESS, "decred", { page: 0 })).rejects.toBeInstanceOf(
      ExplorerError,
    );
    await expect(provider.getTxHistory(ADDRESS, "decred", { limit: 251 })).rejects.toBeInstanceOf(
      ExplorerError,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects fractional-atom amounts and mismatched response identities", async () => {
    stub({ ...transaction(), fees: 0.000000001 });
    await expect(new Dcrdata().getTxDetail(HASH)).rejects.toBeInstanceOf(ExplorerError);
    stub(transaction("a".repeat(64)));
    await expect(new Dcrdata().getTxDetail(HASH)).rejects.toBeInstanceOf(ExplorerError);
    stub([{ height: 2 }]);
    await expect(new Dcrdata().getBlockInfo(1)).rejects.toBeInstanceOf(ExplorerError);
  });
});
