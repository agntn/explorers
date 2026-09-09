import { afterEach, describe, expect, it, vi } from "vitest";
import { create, getDefaultURL, supportsCapability } from "../../src/core/registry.js";
import { normalizeChain } from "../../src/core/types.js";
import { withProvider } from "../../src/core/resolve.js";
import {
  ExplorerError,
  HTTPError,
  UnsupportedChainError,
  UnsupportedOperationError,
} from "../../src/core/errors.js";

const ADDRESS = "Dcur2mcGjmENx4DhNqDctW5wJCVyT3Qeqkx";

/* dcrdata's documented InsightAddressInfo fields, with deliberately conflicting DCR floats. */
function summary() {
  return {
    addrStr: ADDRESS,
    balance: 999,
    balanceSat: 4047213133726,
    totalReceivedSat: 112982935252499,
    totalSentSat: 108935722118773,
    unconfirmedBalanceSat: 0,
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

describe("dcrdata balances", () => {
  it("routes Decred aliases and the provider default through the public registry", async () => {
    stub(summary());
    const result = await withProvider(
      undefined,
      normalizeChain("dcr"),
      async ({ provider, chain }) => {
        expect(provider.name).toBe("dcrdata");
        return provider.getBalance(ADDRESS, chain);
      },
      "balances",
    );
    expect(result).toMatchObject({
      address: ADDRESS,
      chain: "decred",
      symbol: "DCR",
      balance: "4047213133726",
      balanceFormatted: "40472.13133726",
      funded: "112982935252499",
      spent: "108935722118773",
      blockNumber: null,
      blockHash: null,
    });
    expect(Number.isNaN(Date.parse(result.fetchedAt))).toBe(false);
    await expect(withProvider("dcrdata", undefined, async ({ chain }) => chain)).resolves.toBe(
      "decred",
    );
    expect(getDefaultURL("dcrdata")).toBe("https://explorer.dcrdata.org/insight/api");
    expect(supportsCapability("dcrdata", "balances")).toBe(true);
    expect(supportsCapability("dcrdata", "txHistory")).toBe(false);
  });

  it.each([100000001, -100000001, 0])(
    "includes a signed mempool delta of %s atoms",
    async (delta) => {
      const fetch = stub({ ...summary(), balanceSat: 200000000, unconfirmedBalanceSat: delta });
      const provider = await create("dcrdata", { baseUrl: "https://example.test/custom///" });
      const result = await provider.getBalance(ADDRESS);
      expect(result.balance).toBe(String(200000000n + BigInt(delta)));
      expect(fetch).toHaveBeenCalledWith(
        `https://example.test/custom/addr/${ADDRESS}?noTxList=1`,
        expect.objectContaining({ method: "GET" }),
      );
    },
  );

  it("preserves unsafe JSON integer tokens and one-atom precision", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            `{"addrStr":"${ADDRESS}","balanceSat":9007199254740993,"totalReceivedSat":9007199254740995,"totalSentSat":2,"unconfirmedBalanceSat":-1}`,
          ),
      ),
    );
    const provider = await create("dcrdata");
    expect(await provider.getBalance(ADDRESS)).toMatchObject({
      balance: "9007199254740992",
      balanceFormatted: "90071992.54740992",
      funded: "9007199254740995",
      spent: "2",
    });
  });

  it("accepts a zero balance without inventing activity", async () => {
    stub({ ...summary(), balanceSat: 0, totalReceivedSat: 0, totalSentSat: 0 });
    const provider = await create("dcrdata");
    expect(await provider.getBalance(ADDRESS)).toMatchObject({
      balance: "0",
      balanceFormatted: "0",
      funded: "0",
      spent: "0",
    });
  });

  it.each([
    null,
    { ...summary(), balanceSat: 1.5 },
    { ...summary(), balanceSat: -1 },
    { ...summary(), unconfirmedBalanceSat: "NaN" },
    { ...summary(), totalReceivedSat: undefined },
    { ...summary(), addrStr: "other" },
  ])("rejects malformed responses rather than reporting zero", async (body) => {
    stub(body);
    const provider = await create("dcrdata");
    await expect(provider.getBalance(ADDRESS)).rejects.toMatchObject({
      provider: "dcrdata",
      message: "Invalid dcrdata balance response",
    });
  });

  it.each(["../status", `${ADDRESS}?x=1`, ADDRESS.slice(0, -1), ""])(
    "rejects invalid addresses before I/O: %s",
    async (address) => {
      const fetch = stub(summary());
      const provider = await create("dcrdata");
      await expect(provider.getBalance(address)).rejects.toBeInstanceOf(ExplorerError);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("rejects another chain and leaves unimplemented operations unavailable", async () => {
    const fetch = stub(summary());
    const provider = await create("dcrdata");
    await expect(provider.getBalance(ADDRESS, "bitcoin")).rejects.toBeInstanceOf(
      UnsupportedChainError,
    );
    await expect(provider.getTxHistory(ADDRESS)).rejects.toBeInstanceOf(UnsupportedOperationError);
    await expect(provider.getTxHistory(ADDRESS, "bitcoin")).rejects.toBeInstanceOf(
      UnsupportedChainError,
    );
    for (const name of [
      "getTxDetail",
      "getBlockInfo",
      "getGasData",
      "getTokenBalances",
      "getTokenTransfers",
      "getContractInfo",
    ]) {
      expect(name in provider).toBe(false);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([400, 503])("preserves provider attribution on HTTP %s", async (statusCode) => {
    stub({ error: "request failed" }, statusCode);
    const provider = await create("dcrdata");
    const result = provider.getBalance(ADDRESS);
    await expect(result).rejects.toBeInstanceOf(HTTPError);
    await expect(result).rejects.toMatchObject({
      provider: "dcrdata",
      statusCode,
    });
  });
});
