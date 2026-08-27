/**
 * Explorers - Koios (Cardano) provider tests
 *
 * Stubbed responses for the mapping contract, plus a live roundtrip against the keyless public
 * instance.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundError, UnsupportedChainError } from "../../src/core/errors.js";
import { create } from "../../src/core/registry.js";

const ADDRESS =
  "addr1q93k6rgprz5fxwkpvl2vgjq4pwejth400f8aldz2m3lj7khrnd05p259l0qjrf396am6wahv5895ey35y62fexta3q5q3cc3k8";
const OTHER =
  "addr1q9xvgr4ehvu5k5tmaly7ugpnvekpqvnxj8xy50pa7kyetlnhel389pa4rnq6fmkzwsaynmw0mnldhlmchn2sfd589fgsz9dd0y";

/** Koios rejects a request body over this many bytes, which is why `tx_info` calls are batched. */
const BODY_LIMIT = 5120;

const hashOf = (index: number) => index.toString(16).padStart(64, "0");

/** A send: the address funds the transaction and one output goes somewhere else. */
const SEND = {
  tx_hash: hashOf(1),
  block_height: 13_863_477,
  tx_timestamp: 1_787_843_962,
  total_output: "9999999999999800001",
  fee: "200000",
  inputs: [{ value: "10000000000000000001", payment_addr: { bech32: ADDRESS } }],
  outputs: [
    { value: "3000000000000000001", payment_addr: { bech32: OTHER } },
    { value: "6999999999999800000", payment_addr: { bech32: ADDRESS } },
  ],
  collateral_inputs: [],
};

/** A receive: someone else funds the transaction and the address is paid. */
const RECEIVE = {
  tx_hash: hashOf(2),
  block_height: 13_863_476,
  tx_timestamp: 1_787_843_925,
  total_output: "4800000",
  fee: "200000",
  inputs: [{ value: "5000000", payment_addr: { bech32: OTHER } }],
  outputs: [
    { value: "2000000", payment_addr: { bech32: ADDRESS } },
    { value: "2800000", payment_addr: { bech32: OTHER } },
  ],
  collateral_inputs: [{ value: "5000000", payment_addr: { bech32: OTHER } }],
};

const rowOf = (tx: { tx_hash: string; block_height: number; tx_timestamp: number }) => ({
  tx_hash: tx.tx_hash,
  epoch_no: 651,
  block_height: tx.block_height,
  block_time: tx.tx_timestamp,
});

/** Answer each call with the next body, repeating the last one once the list runs out. */
function stubJSONPages(bodies: unknown[]) {
  let call = 0;
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
    const body = bodies[Math.min(call++, bodies.length - 1)];
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return new Response(text, { headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

const stubJSON = (body: unknown) => stubJSONPages([body]);

const bodyOf = (call: [RequestInfo | URL, (RequestInit | undefined)?]) =>
  JSON.parse(String(call[1]?.body)) as Record<string, unknown>;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("koios provider", () => {
  let provider: Awaited<ReturnType<typeof create>>;

  beforeEach(async () => {
    provider = await create("koios", { baseUrl: "https://example.test/api/v1/" });
  });

  it("reports only the operations Koios serves", () => {
    expect(provider.capabilities).toEqual({
      balances: true,
      txHistory: true,
      txDetail: true,
      contractInfo: false,
      tokenBalances: true,
      tokenTransfers: false,
      gasData: false,
      blockInfo: false,
    });
    expect(provider.getGasData).toBeUndefined();
    expect(provider.getBlockInfo).toBeUndefined();
    expect(provider.getContractInfo).toBeUndefined();
    expect(provider.getTokenTransfers).toBeUndefined();
  });

  it("serves Cardano only", async () => {
    await expect(provider.getBalance(ADDRESS, "ethereum")).rejects.toThrow(UnsupportedChainError);
    await expect(provider.getTxHistory(ADDRESS, "bitcoin")).rejects.toThrow(UnsupportedChainError);
    await expect(provider.getTxDetail!(hashOf(1), "solana")).rejects.toThrow(UnsupportedChainError);
    await expect(provider.getTokenBalances!(ADDRESS, "ton")).rejects.toThrow(UnsupportedChainError);
  });

  it("reads a balance in lovelace and asks for it in the request body", async () => {
    const fetch = stubJSON([
      { address: ADDRESS, balance: "293356537534", stake_address: null, script_address: false },
    ]);

    await expect(provider.getBalance(ADDRESS)).resolves.toEqual({
      address: ADDRESS,
      chain: "cardano",
      balance: "293356537534",
      balanceFormatted: "293356.537534",
      symbol: "ADA",
    });

    const call = fetch.mock.calls[0]!;
    expect(String(call[0])).toBe(
      "https://example.test/api/v1/address_info?select=address%2Cbalance",
    );
    expect(bodyOf(call)).toEqual({ _addresses: [ADDRESS] });
  });

  it("treats an address the ledger never saw as not found", async () => {
    stubJSON([]);
    await expect(provider.getBalance("addr1zzzzzzzzzz")).rejects.toThrow(NotFoundError);
  });

  it("keeps the history in the order the tx hash list asked for", async () => {
    /** `tx_info` answers in its own order, so reading it positionally scrambles the page. */
    stubJSONPages([
      [rowOf(SEND), rowOf(RECEIVE)],
      [RECEIVE, SEND],
    ]);

    const history = await provider.getTxHistory(ADDRESS, "cardano", { limit: 2 });

    expect(history.map((tx) => tx.hash)).toEqual([SEND.tx_hash, RECEIVE.tx_hash]);
  });

  it("reports what the address sent, net of its own change and the fee", async () => {
    stubJSONPages([[rowOf(SEND)], [SEND]]);

    await expect(provider.getTxHistory(ADDRESS, "cardano")).resolves.toEqual([
      expect.objectContaining({
        hash: SEND.tx_hash,
        blockNumber: 13_863_477,
        timestamp: "2026-08-27T15:19:22.000Z",
        from: ADDRESS,
        to: OTHER,
        /** Exact to the last lovelace: these amounts run past Number.MAX_SAFE_INTEGER. */
        value: "3000000000000000001",
        valueFormatted: "3000000000000.000001",
        fee: "200000",
        status: "success",
        isContractInteraction: false,
        tokenTransfers: [],
      }),
    ]);
  });

  it("reports what the address received, and reads collateral as a contract call", async () => {
    stubJSONPages([[rowOf(RECEIVE)], [RECEIVE]]);

    await expect(provider.getTxHistory(ADDRESS, "cardano")).resolves.toEqual([
      expect.objectContaining({
        from: OTHER,
        to: ADDRESS,
        value: "2000000",
        valueFormatted: "2",
        isContractInteraction: true,
      }),
    ]);
  });

  it("reports a gain even when the address funded the transaction", async () => {
    /** A script payout: the address puts up an input and still ends the transaction richer. */
    const claim = {
      ...RECEIVE,
      inputs: [
        { value: "5000000", payment_addr: { bech32: OTHER } },
        { value: "1000000", payment_addr: { bech32: ADDRESS } },
      ],
      outputs: [
        { value: "5800000", payment_addr: { bech32: ADDRESS } },
        { value: "0", payment_addr: { bech32: OTHER } },
      ],
    };
    stubJSONPages([[rowOf(claim)], [claim]]);

    await expect(provider.getTxHistory(ADDRESS, "cardano")).resolves.toMatchObject([
      { from: ADDRESS, to: OTHER, value: "4800000" },
    ]);
  });

  it("never reports a negative movement when someone else paid the fee", async () => {
    /** The address is short 0.5 ADA, the fee is 0.8, and nothing says which input covered it. */
    const shared = {
      ...RECEIVE,
      fee: "800000",
      inputs: [
        { value: "1000000", payment_addr: { bech32: ADDRESS } },
        { value: "9000000", payment_addr: { bech32: OTHER } },
      ],
      outputs: [
        { value: "500000", payment_addr: { bech32: ADDRESS } },
        { value: "8700000", payment_addr: { bech32: OTHER } },
      ],
    };
    stubJSONPages([[rowOf(shared)], [shared]]);

    await expect(provider.getTxHistory(ADDRESS, "cardano")).resolves.toMatchObject([
      { from: ADDRESS, to: OTHER, value: "0", valueFormatted: "0" },
    ]);
  });

  it("passes paging, ordering and the block window to Koios", async () => {
    const fetch = stubJSONPages([[], []]);

    await provider.getTxHistory(ADDRESS, "cardano", {
      limit: 25,
      page: 3,
      sort: "asc",
      startBlock: 12_408_744,
      endBlock: 13_863_477,
    });

    const call = fetch.mock.calls[0]!;
    expect(String(call[0])).toBe(
      "https://example.test/api/v1/address_txs?limit=25&offset=50&order=block_height.asc&block_height=lte.13863477",
    );
    expect(bodyOf(call)).toEqual({ _addresses: [ADDRESS], _after_block_height: 12_408_744 });
  });

  it("splits a history page into request bodies Koios accepts", async () => {
    const rows = Array.from({ length: 100 }, (_, index) => ({
      tx_hash: hashOf(index),
      epoch_no: 651,
      block_height: 13_863_477 - index,
      block_time: 1_787_843_962,
    }));
    const fetch = stubJSONPages([rows, [], []]);

    await provider.getTxHistory(ADDRESS, "cardano", { limit: 100 });

    const txInfoCalls = fetch.mock.calls.slice(1);
    expect(txInfoCalls).toHaveLength(2);
    for (const call of txInfoCalls) {
      const body = String(call[1]?.body);
      expect(body.length).toBeLessThan(BODY_LIMIT);
      expect(JSON.parse(body)).toMatchObject({ _inputs: true });
    }
    expect(txInfoCalls.flatMap((call) => bodyOf(call)._tx_hashes as string[])).toEqual(
      rows.map((row) => row.tx_hash),
    );
  });

  it("reads one transaction as a whole when no address frames it", async () => {
    stubJSON([SEND]);

    await expect(provider.getTxDetail!(SEND.tx_hash, "cardano")).resolves.toMatchObject({
      hash: SEND.tx_hash,
      from: ADDRESS,
      to: OTHER,
      value: "9999999999999800001",
      valueFormatted: "9999999999999.800001",
    });
  });

  it("throws NotFoundError for a transaction hash Koios does not know", async () => {
    stubJSON([]);
    await expect(provider.getTxDetail!(hashOf(9), "cardano")).rejects.toThrow(NotFoundError);
  });

  it("names an asset by its bytes when they read as text", async () => {
    stubJSON([
      {
        policy_id: "0691b2fecca1ac4f53cb6dfb00b7013e561d1f34403b957cbb5af1fa",
        asset_name: "4e49474854",
        fingerprint: "asset1wd3llgkhsw6etxf2yca6cgk9ssrpva3wf0pq9a",
        decimals: 6,
        quantity: "418770172713",
      },
    ]);

    await expect(provider.getTokenBalances!(ADDRESS, "cardano")).resolves.toEqual([
      {
        contract: "0691b2fecca1ac4f53cb6dfb00b7013e561d1f34403b957cbb5af1fa4e49474854",
        symbol: "NIGHT",
        decimals: 6,
        balance: "418770172713",
        balanceFormatted: "418770.172713",
      },
    ]);
  });

  it("falls back to the fingerprint when the name is not printable text", async () => {
    stubJSON([
      /** A right-to-left override, which reorders whatever the CLI prints after it. */
      {
        policy_id: "aa",
        asset_name: "e280ae",
        fingerprint: "asset1bidi",
        decimals: null,
        quantity: "1",
      },
      /** U+2028, a line break to every renderer that honours it, printed straight into a list. */
      {
        policy_id: "ee",
        asset_name: "e280a8",
        fingerprint: "asset1line",
        decimals: 0,
        quantity: "1",
      },
      /** U+2029, the same forged break one category over. */
      {
        policy_id: "ff",
        asset_name: "e280a9",
        fingerprint: "asset1para",
        decimals: 0,
        quantity: "1",
      },
      /** Bytes that are not UTF-8 at all. */
      {
        policy_id: "bb",
        asset_name: "ff",
        fingerprint: "asset1raw",
        decimals: null,
        quantity: "0",
      },
      /** An asset minted without a name. */
      { policy_id: "cc", asset_name: null, fingerprint: "asset1bare", decimals: 0, quantity: "7" },
      /** Half a byte at the end: reading on would name the asset after a fragment of itself. */
      { policy_id: "dd", asset_name: "414", fingerprint: "asset1odd", decimals: 0, quantity: "3" },
    ]);

    await expect(provider.getTokenBalances!(ADDRESS, "cardano")).resolves.toMatchObject([
      { symbol: "asset1bidi", decimals: 0, balanceFormatted: "1" },
      { symbol: "asset1line" },
      { symbol: "asset1para" },
      { symbol: "asset1raw", balance: "0" },
      { symbol: "asset1bare", contract: "cc" },
      { symbol: "asset1odd", contract: "dd414" },
    ]);
  });

  it("drops empty holdings on request", async () => {
    stubJSON([
      { policy_id: "aa", asset_name: "41", fingerprint: "asset1a", decimals: 0, quantity: "5" },
      { policy_id: "bb", asset_name: "42", fingerprint: "asset1b", decimals: 0, quantity: "0" },
    ]);

    await expect(
      provider.getTokenBalances!(ADDRESS, "cardano", { nonZeroOnly: true }),
    ).resolves.toHaveLength(1);
  });

  it("walks past the first page an address with thousands of assets fills", async () => {
    const page = (count: number, offset: number) =>
      Array.from({ length: count }, (_, index) => ({
        policy_id: "aa",
        asset_name: (offset + index).toString(16).padStart(2, "0"),
        fingerprint: `asset1${offset + index}`,
        decimals: 0,
        quantity: "1",
      }));
    const fetch = stubJSONPages([page(1000, 0), page(4, 1000)]);

    await expect(provider.getTokenBalances!(ADDRESS, "cardano")).resolves.toHaveLength(1004);

    expect(fetch.mock.calls.map((call) => String(call[0]))).toEqual([
      "https://example.test/api/v1/address_assets?limit=1000",
      "https://example.test/api/v1/address_assets?limit=1000&offset=1000",
    ]);
  });
});

describe("koios provider, live", () => {
  /** The public tier is rate limited and rebuilds the UTxO set per call, so it answers slowly. */
  it("reads an address off the public instance without a key", async () => {
    const provider = await create("koios");
    const balance = await provider.getBalance(OTHER, "cardano");

    expect(balance.chain).toBe("cardano");
    expect(balance.symbol).toBe("ADA");
    expect(balance.balance).toMatch(/^\d+$/);
    expect(Number(balance.balanceFormatted)).toBeGreaterThan(0);
  }, 30_000);
});
