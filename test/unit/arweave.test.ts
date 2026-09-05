import { afterEach, describe, expect, it, vi } from "vitest";
import { Arweave } from "../../src/providers/arweave.js";
import { create, supportsCapability } from "../../src/core/registry.js";
import { withProvider } from "../../src/core/resolve.js";
import { ExplorerError, NotFoundError, UnsupportedChainError } from "../../src/core/errors.js";

const ADDRESS = "FPjbN_btYKzcf8QASjs30v5C0FPv7XpwKXENBW8dqVw";
const HASH = "2Bg8S0GcQmbC-FeT5dDKcj0WOK2YmH7Y4mlW-mO8_yE";

function transaction(id = HASH, height: number | null = 1994692) {
  return {
    id,
    owner: { address: ADDRESS },
    recipient: "",
    quantity: { winston: "9007199254740993" },
    fee: { winston: "3242223203" },
    block: height === null ? null : { height, timestamp: 1788612434 },
    bundledIn: null,
    data: { size: "3044", type: null },
    tags: [{ name: "App-Name", value: "test" }],
  };
}

function json(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}

function stub(body: unknown) {
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => json(body));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function connection(nodes: readonly unknown[], hasNextPage = false, cursor = "cursor") {
  return {
    data: {
      transactions: {
        pageInfo: { hasNextPage },
        edges: nodes.map((node, index) => ({ cursor: `${cursor}-${index}`, node })),
      },
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("Arweave gateway", () => {
  it("registers gateway reads and selects its default chain", async () => {
    const provider = await create("arweave");
    expect(provider).toBeInstanceOf(Arweave);
    expect(provider.capabilities).toEqual({
      balances: true,
      txHistory: true,
      txDetail: true,
      contractInfo: false,
      tokenBalances: false,
      tokenTransfers: false,
      gasData: false,
      blockInfo: true,
    });
    expect(supportsCapability("arweave", "balances")).toBe(true);
    expect(supportsCapability("arweave", "blockInfo")).toBe(true);
    expect(provider.getTokenBalances).toBeUndefined();
    await expect(withProvider("arweave", undefined, async ({ chain }) => chain)).resolves.toBe(
      "arweave",
    );
  });

  it.each([
    ["0", "0"],
    ["141635438646382", "141.635438646382"],
    ["9007199254740993", "9007.199254740993"],
  ])("reads an exact native balance of %s from gateway REST", async (amount, formatted) => {
    const fetch = vi.fn(
      async () => new Response(amount, { headers: { "Content-Type": "text/plain" } }),
    );
    vi.stubGlobal("fetch", fetch);
    const provider = new Arweave({ baseUrl: "https://example.test/custom///" });
    const balance = await provider.getBalance(ADDRESS);
    expect(balance).toMatchObject({
      address: ADDRESS,
      chain: "arweave",
      balance: amount,
      symbol: "AR",
      blockNumber: null,
      blockHash: null,
    });
    expect(balance.balanceFormatted).toBe(formatted);
    expect(Number.isNaN(Date.parse(balance.fetchedAt))).toBe(false);
    expect(fetch).toHaveBeenCalledWith(
      `https://example.test/custom/wallet/${ADDRESS}/balance`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it.each([-1, 1.5, {}, null, "not a balance"])(
    "rejects malformed native balance responses",
    async (body) => {
      stub(body);
      await expect(new Arweave().getBalance(ADDRESS)).rejects.toMatchObject({
        provider: "arweave",
        name: "ExplorerError",
      });
    },
  );

  it("reads block metadata, including genesis without a parent", async () => {
    const fetch = stub({
      height: 0,
      indep_hash: "7wIU7KolICAjClMlcZ38LZzshhI7xGkm2tDCJR7Wvhe3ESUo2-Z4-y0x1uaglRJE",
      previous_block: "",
      timestamp: 1528491597,
      reward_addr: "unclaimed",
      txs: [HASH],
    });
    const block = await new Arweave({ baseUrl: "https://example.test/custom///" }).getBlockInfo(0);
    expect(block).toEqual({
      number: 0,
      hash: "7wIU7KolICAjClMlcZ38LZzshhI7xGkm2tDCJR7Wvhe3ESUo2-Z4-y0x1uaglRJE",
      parentHash: "",
      timestamp: "2018-06-08T20:59:57.000Z",
      miner: "unclaimed",
      txCount: 1,
      gasUsed: "0",
      gasLimit: "0",
    });
    expect(fetch.mock.calls[0]?.[0]).toBe("https://example.test/custom/block/height/0");
  });

  it("rejects a malformed block or a different height", async () => {
    stub({
      height: 1,
      indep_hash: "hash",
      previous_block: "parent",
      timestamp: 1528491598,
      reward_addr: "miner",
      txs: [],
    });
    await expect(new Arweave().getBlockInfo(1)).resolves.toMatchObject({
      number: 1,
      parentHash: "parent",
      txCount: 0,
    });
    await expect(new Arweave().getBlockInfo(2)).rejects.toThrow(ExplorerError);
    stub({});
    await expect(new Arweave().getBlockInfo(0)).rejects.toThrow(ExplorerError);
  });

  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid block heights before I/O",
    async (height) => {
      const fetch = stub({});
      await expect(new Arweave().getBlockInfo(height)).rejects.toThrow(ExplorerError);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("keeps gateway REST failures attributed without another backend", async () => {
    const fetch = vi.fn(async () => new Response("not found", { status: 404 }));
    vi.stubGlobal("fetch", fetch);
    await expect(new Arweave().getBlockInfo(999999999)).rejects.toMatchObject({
      name: "NotFoundError",
      provider: "arweave",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("maps exact winstons and preserves data metadata through the real HTTP client", async () => {
    const tx = transaction();
    const fetch = stub({ data: { transaction: tx } });
    const provider = new Arweave({ baseUrl: "https://example.test/custom/" });
    await expect(provider.getTxDetail(HASH)).resolves.toMatchObject({
      hash: HASH,
      from: ADDRESS,
      to: "",
      value: "9007199254740993",
      valueFormatted: "9007.199254740993",
      fee: "3242223203",
      blockNumber: 1994692,
      timestamp: new Date(1788612434000).toISOString(),
      status: "success",
      isContractInteraction: false,
      tokenTransfers: [],
      raw: tx,
    });
    const call = fetch.mock.calls[0];
    expect(call?.[0]).toBe("https://example.test/custom/graphql");
    expect(call?.[1]?.method).toBe("POST");
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ variables: { id: HASH } });
  });

  it("keeps unconfirmed data items pending and does not invent their fee", async () => {
    stub({ data: { transaction: { ...transaction(HASH, null), bundledIn: { id: HASH } } } });
    const tx = await new Arweave().getTxDetail(HASH);
    expect(tx.status).toBe("pending");
    expect(tx.blockNumber).toBe(0);
    expect(tx.timestamp).toBeUndefined();
    expect(tx.fee).toBeUndefined();
  });

  it("distinguishes an absent transaction from a broken GraphQL response", async () => {
    stub({ data: { transaction: null } });
    await expect(new Arweave().getTxDetail(HASH)).rejects.toThrow(NotFoundError);
  });

  it.each([
    { errors: [{ message: "query timed out" }] },
    { data: { transaction: transaction() }, errors: [{ message: "partial result" }] },
    {},
    { data: null },
    { data: { transaction: { ...transaction(), quantity: { winston: 1.5 } } } },
  ])("rejects errors and malformed data instead of reporting success", async (body) => {
    stub(body);
    await expect(new Arweave().getTxDetail(HASH)).rejects.toMatchObject({
      provider: "arweave",
      name: "ExplorerError",
    });
  });

  it("keeps transport errors attributed to the provider", async () => {
    vi.stubGlobal("fetch", async () => new Response("denied", { status: 403 }));
    await expect(new Arweave().getTxDetail(HASH)).rejects.toMatchObject({
      provider: "arweave",
      name: "AuthError",
    });
  });

  it("merges incoming and outgoing history before slicing pages and removes self transfers", async () => {
    const queries: Array<{ query: string; variables: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        query: string;
        variables: Record<string, unknown>;
      };
      queries.push(request);
      return json(
        connection(
          request.query.includes("transactions(owners:")
            ? [transaction("sent", 40), transaction("self", 20)]
            : [transaction("received", 30), transaction("self", 20), transaction("older", 10)],
        ),
      );
    });
    const txs = await new Arweave().getTxHistory(ADDRESS, "arweave", {
      limit: 2,
      page: 2,
      startBlock: 10,
      endBlock: 40,
    });
    expect(txs.map((tx) => tx.hash)).toEqual(["self", "older"]);
    expect(queries).toHaveLength(2);
    expect(queries[0]?.variables).toEqual({
      addresses: [ADDRESS],
      first: 4,
      sort: "HEIGHT_DESC",
      block: { min: 10, max: 40 },
    });
  });

  it("walks each direction's cursor even when the API returns a short page", async () => {
    const cursors: unknown[] = [];
    vi.stubGlobal("fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        query: string;
        variables: Record<string, unknown>;
      };
      if (request.query.includes("transactions(recipients:")) return json(connection([]));
      cursors.push(request.variables.after);
      expect(request.variables.sort).toBe("HEIGHT_ASC");
      return json(
        request.variables.after
          ? connection([transaction("second", 2)])
          : connection([transaction("first", 1)], true, "next"),
      );
    });
    const txs = await new Arweave().getTxHistory(ADDRESS, "arweave", { limit: 2, sort: "asc" });
    expect(txs.map((tx) => tx.hash)).toEqual(["first", "second"]);
    expect(cursors).toEqual([undefined, "next-0"]);
  });

  it("returns an empty history without a node fallback", async () => {
    const fetch = stub(connection([]));
    await expect(new Arweave().getTxHistory(ADDRESS)).resolves.toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([connection([], true), connection([transaction()], true)])(
    "rejects a stalled cursor",
    async (body) => {
      stub(body);
      await expect(new Arweave().getTxHistory(ADDRESS, "arweave", { limit: 3 })).rejects.toThrow(
        "cursor did not advance",
      );
    },
  );

  it("rejects invalid identifiers and chains before I/O", async () => {
    const fetch = stub({});
    const provider = new Arweave();
    await expect(provider.getTxDetail("../graphql")).rejects.toThrow(ExplorerError);
    await expect(provider.getTxHistory(`${ADDRESS}?x`)).rejects.toThrow(ExplorerError);
    await expect(provider.getTxHistory(ADDRESS, "ethereum")).rejects.toThrow(UnsupportedChainError);
    await expect(provider.getTxDetail(HASH, "ethereum")).rejects.toThrow(UnsupportedChainError);
    await expect(provider.getBalance(ADDRESS, "ethereum")).rejects.toThrow(UnsupportedChainError);
    await expect(provider.getBlockInfo(0, "ethereum")).rejects.toThrow(UnsupportedChainError);
    await expect(provider.getBalance("../other")).rejects.toThrow(ExplorerError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { limit: 0 },
    { limit: 101 },
    { limit: NaN },
    { page: 0 },
    { page: 1.5 },
    { page: 11 },
    { startBlock: -1 },
    { endBlock: 2147483648 },
    { startBlock: 2, endBlock: 1 },
  ])("bounds history work before I/O", async (options) => {
    const fetch = stub({});
    await expect(new Arweave().getTxHistory(ADDRESS, "arweave", options)).rejects.toThrow(
      ExplorerError,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("accepts the last allowed window and inclusive block bounds", async () => {
    stub(connection([]));
    await expect(
      new Arweave().getTxHistory(ADDRESS, "arweave", {
        limit: 100,
        page: 10,
        startBlock: 0,
        endBlock: 2147483647,
      }),
    ).resolves.toEqual([]);
  });
});
