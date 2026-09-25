import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { create, getDefaultURL, supportsCapability } from "../../src/core/registry.ts";
import { normalizeChain } from "../../src/core/types.ts";
import { resolveProvider, withProvider } from "../../src/core/resolve.ts";
import { ExplorerError, HTTPError, UnsupportedChainError } from "../../src/core/errors.ts";
import { classifyInput } from "../../src/core/input.ts";

const ADDRESS = "GAHK7EEG2WWHVKDNT4CEQFZGKF2LGDSW2IVM4S5DP42RBW3K6BTODB4A";
const USDC = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const VELO = "GDM4RQUQQUVSKQA7S6EM7XBZP3FCGH4Q7CL6TABQ7B2BEJ5ERARM2M5M";

/* Horizon's account record for a funded account with two trustlines and one pool share. */
function account() {
  return {
    id: ADDRESS,
    account_id: ADDRESS,
    sequence: "64041853623977968",
    subentry_count: 3,
    last_modified_ledger: 64490662,
    balances: [
      {
        balance: "0.0000000",
        limit: "922337203685.4775807",
        asset_type: "credit_alphanum4",
        asset_code: "USDC",
        asset_issuer: USDC,
      },
      {
        balance: "1234.5000001",
        limit: "922337203685.4775807",
        asset_type: "credit_alphanum4",
        asset_code: "VELO",
        asset_issuer: VELO,
      },
      {
        balance: "5.0000000",
        asset_type: "liquidity_pool_shares",
        liquidity_pool_id: "c".repeat(64),
      },
      { balance: "12.8193804", asset_type: "native" },
    ],
  };
}

function stub(body: unknown, status = 200) {
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => vi.unstubAllGlobals());

describe("horizon balances", () => {
  it("routes Stellar aliases and the provider default through the public registry", async () => {
    stub(account());
    const result = await withProvider(
      undefined,
      normalizeChain("xlm"),
      async ({ provider, chain }) => {
        expect(provider.name).toBe("horizon");
        return provider.getBalance(ADDRESS, chain);
      },
      "balances",
    );
    expect(result).toMatchObject({
      address: ADDRESS,
      chain: "stellar",
      symbol: "XLM",
      balance: "128193804",
      balanceFormatted: "12.8193804",
      blockNumber: null,
      blockHash: null,
    });
    expect(result).not.toHaveProperty("funded");
    expect(result).not.toHaveProperty("unconfirmed");
    expect(Number.isNaN(Date.parse(result.fetchedAt))).toBe(false);
    await expect(withProvider("horizon", undefined, async ({ chain }) => chain)).resolves.toBe(
      "stellar",
    );
    expect(resolveProvider(undefined, "stellar", "tokenTransfers")).toBe("horizon");
    expect(getDefaultURL("horizon")).toBe("https://horizon.stellar.org");
    for (const capability of [
      "balances",
      "txHistory",
      "txDetail",
      "tokenBalances",
      "tokenTransfers",
      "gasData",
      "blockInfo",
    ] as const) {
      expect(supportsCapability("horizon", capability)).toBe(true);
    }
    expect(supportsCapability("horizon", "utxos")).toBe(false);
    expect(supportsCapability("horizon", "contractInfo")).toBe(false);
  });

  it("reads the account from a custom Horizon and keeps one-stroop precision", async () => {
    const fetch = stub(account());
    const provider = await create("horizon", { baseUrl: "https://example.test/horizon///" });
    const result = await provider.getBalance(ADDRESS);
    expect(result.balance).toBe("128193804");
    expect(fetch).toHaveBeenCalledWith(
      `https://example.test/horizon/accounts/${ADDRESS}`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("reports an account with no native entry as empty", async () => {
    stub({ ...account(), balances: [] });
    const provider = await create("horizon");
    expect(await provider.getBalance(ADDRESS)).toMatchObject({
      balance: "0",
      balanceFormatted: "0",
    });
  });

  it("maps a missing account to NotFoundError and rejects other chains before I/O", async () => {
    const fetch = stub(
      { type: "https://stellar.org/horizon-errors/not_found", title: "Resource Missing" },
      404,
    );
    const provider = await create("horizon");
    await expect(provider.getBalance(ADDRESS)).rejects.toMatchObject({ name: "NotFoundError" });
    await expect(provider.getBalance(ADDRESS, "ethereum")).rejects.toBeInstanceOf(
      UnsupportedChainError,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    "GAHK7EEG2WWHVKDNT4CEQFZGKF2LGDSW2IVM4S5DP42RBW3K6BTODB4B",
    "MA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUAAAAAAAAAAAAAAAA",
    "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    "../fee_stats",
  ])("rejects %s as a Stellar account id without a request", async (input) => {
    const fetch = stub(account());
    const provider = await create("horizon");
    await expect(provider.getBalance(input)).rejects.toThrow("Invalid Stellar account id");
    await expect(provider.getTokenBalances?.(input)).rejects.toThrow("Invalid Stellar account id");
    await expect(provider.getTxHistory(input)).rejects.toThrow("Invalid Stellar account id");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    null,
    { ...account(), id: "other" },
    { ...account(), balances: [{ asset_type: "native", balance: "1.5e3" }] },
    { ...account(), balances: [{ asset_type: "native", balance: "-1.0000000" }] },
    { ...account(), balances: [{ asset_type: "native", balance: "1.00000001" }] },
  ])("rejects a malformed account response %#", async (body) => {
    stub(body);
    const provider = await create("horizon");
    await expect(provider.getBalance(ADDRESS)).rejects.toThrow(ExplorerError);
  });

  it("surfaces the HTTP status of a failed read", async () => {
    stub({ title: "Internal Server Error" }, 500);
    const provider = await create("horizon");
    await expect(provider.getBalance(ADDRESS)).rejects.toBeInstanceOf(HTTPError);
  });
});

describe("horizon token holdings", () => {
  it("lists trustlines as CODE:ISSUER holdings with seven decimals and skips pool shares", async () => {
    stub(account());
    const provider = await create("horizon");
    expect(await provider.getTokenBalances?.(ADDRESS)).toEqual([
      {
        contract: `USDC:${USDC}`,
        symbol: "USDC",
        decimals: 7,
        balance: "0",
        balanceFormatted: "0",
      },
      {
        contract: `VELO:${VELO}`,
        symbol: "VELO",
        decimals: 7,
        balance: "12345000001",
        balanceFormatted: "1234.5000001",
      },
    ]);
  });

  it("drops empty trustlines on request", async () => {
    stub(account());
    const provider = await create("horizon");
    const holdings = await provider.getTokenBalances?.(ADDRESS, "stellar", { nonZeroOnly: true });
    expect(holdings?.map((holding) => holding.symbol)).toEqual(["VELO"]);
  });
});

describe("horizon fee stats", () => {
  it("maps charged-fee percentiles and the ledger base fee to stroops", async () => {
    stub({
      last_ledger: "64493590",
      last_ledger_base_fee: "100",
      ledger_capacity_usage: "0.55",
      fee_charged: { max: "275080", min: "100", mode: "100", p50: "100", p80: "150", p95: "6976" },
      max_fee: {
        max: "20000000",
        min: "100",
        mode: "20001",
        p50: "20001",
        p80: "20001",
        p95: "20001",
      },
    });
    const provider = await create("horizon");
    expect(await provider.getGasData?.()).toEqual({
      chain: "stellar",
      unit: "stroops",
      safeGasPrice: "100",
      fastGasPrice: "6976",
      baseFee: "100",
    });
  });

  it("rejects fee stats without the charged distribution", async () => {
    stub({ last_ledger_base_fee: "100", fee_charged: { p50: "100" }, max_fee: { mode: "100" } });
    const provider = await create("horizon");
    await expect(provider.getGasData?.()).rejects.toThrow("Invalid Horizon fee stats response");
  });
});

describe("horizon ledgers", () => {
  it("reads one ledger as a block and counts failed transactions too", async () => {
    const fetch = stub({
      id: "a".repeat(64),
      hash: "a".repeat(64),
      prev_hash: "b".repeat(64),
      sequence: 64493581,
      successful_transaction_count: 128,
      failed_transaction_count: 29,
      operation_count: 364,
      closed_at: "2026-09-18T17:48:03Z",
      base_fee_in_stroops: 100,
      base_reserve_in_stroops: 5000000,
      protocol_version: 28,
    });
    const provider = await create("horizon");
    expect(await provider.getBlockInfo?.(64493581)).toEqual({
      number: 64493581,
      hash: "a".repeat(64),
      parentHash: "b".repeat(64),
      timestamp: "2026-09-18T17:48:03.000Z",
      miner: "",
      gasUsed: "0",
      gasLimit: "0",
      txCount: 157,
      baseFee: "100",
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://horizon.stellar.org/ledgers/64493581",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("rejects a ledger whose sequence differs from the request and bad sequences before I/O", async () => {
    const fetch = stub({ sequence: 7, hash: "a".repeat(64), closed_at: "2026-09-18T17:48:03Z" });
    const provider = await create("horizon");
    await expect(provider.getBlockInfo?.(8)).rejects.toThrow("Invalid Horizon ledger response");
    for (const sequence of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(provider.getBlockInfo?.(sequence)).rejects.toThrow(
        "Stellar ledger sequence must be a positive safe integer",
      );
    }
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("stellar input", () => {
  it("classifies 64 hex characters as a transaction hash on Stellar", () => {
    expect(classifyInput("a".repeat(64), "stellar")).toBe("txhash");
    expect(classifyInput(ADDRESS, "stellar")).toBe("address");
  });
});
