import { afterEach, describe, expect, it, vi } from "vitest";
import { RateLimitError, UnsupportedChainError } from "../../src/core/errors.js";
import { create } from "../../src/core/registry.js";
import "../../src/providers/etherscan.js";

const ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

function stubJSON(body: unknown) {
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("etherscan provider", () => {
  it("uses the unified V2 endpoint and chain ID", async () => {
    const fetch = stubJSON({ status: "1", message: "OK", result: "1000000000000000000" });
    const provider = create("etherscan", {
      apiKey: "secret",
      baseUrl: "https://example.test/v2/api/",
      defaultChain: "base",
    });

    const balance = await provider.getBalance(ADDRESS);

    const requestUrl = new URL(String(fetch.mock.calls[0]?.[0]));
    expect(`${requestUrl.origin}${requestUrl.pathname}`).toBe("https://example.test/v2/api");
    expect(requestUrl.searchParams.get("chainid")).toBe("8453");
    expect(requestUrl.searchParams.get("module")).toBe("account");
    expect(requestUrl.searchParams.get("action")).toBe("balance");
    expect(requestUrl.searchParams.get("apikey")).toBe("secret");
    expect(balance).toMatchObject({ chain: "base", balanceFormatted: "1", symbol: "ETH" });
  });

  it("maps V2 address token holdings", async () => {
    const fetch = stubJSON({
      status: "1",
      message: "OK",
      result: [
        {
          TokenAddress: "0x0000000000000000000000000000000000000001",
          TokenName: "Example Token",
          TokenSymbol: "EXT",
          TokenDivisor: "6",
          TokenQuantity: "1250000",
        },
      ],
    });
    const provider = create("etherscan", { apiKey: "secret" });

    const tokens = await provider.getTokenBalances!(ADDRESS, "eth");

    expect(new URL(String(fetch.mock.calls[0]?.[0])).searchParams.get("action")).toBe(
      "addresstokenbalance",
    );
    expect(tokens).toEqual([
      {
        contract: "0x0000000000000000000000000000000000000001",
        name: "Example Token",
        symbol: "EXT",
        decimals: 6,
        balance: "1250000",
        balanceFormatted: "1.25",
      },
    ]);
  });

  it("returns complete block identity through the proxy API", async () => {
    stubJSON({
      jsonrpc: "2.0",
      id: 1,
      result: {
        number: "0x10",
        hash: "0xblock",
        parentHash: "0xparent",
        timestamp: "0x64",
        miner: "0xminer",
        gasLimit: "0x100",
        gasUsed: "0x80",
        baseFeePerGas: "0x7",
        transactions: ["0xtx1", "0xtx2"],
      },
    });
    const provider = create("etherscan", { apiKey: "secret" });

    const block = await provider.getBlockInfo!(16, "eth");

    expect(block).toEqual({
      number: 16,
      hash: "0xblock",
      parentHash: "0xparent",
      timestamp: new Date(100_000).toISOString(),
      miner: "0xminer",
      gasUsed: "128",
      gasLimit: "256",
      txCount: 2,
      baseFee: "7",
    });
  });

  it("maps proxy metadata from verified source responses", async () => {
    stubJSON({
      status: "1",
      message: "OK",
      result: [
        {
          ABI: "[]",
          ContractName: "Proxy",
          CompilerVersion: "v0.8.30",
          SourceCode: "contract Proxy {}",
          Proxy: "1",
          Implementation: "0x0000000000000000000000000000000000000002",
        },
      ],
    });
    const provider = create("etherscan", { apiKey: "secret" });

    await expect(provider.getContractInfo(ADDRESS, "eth")).resolves.toMatchObject({
      isVerified: true,
      isProxy: true,
      implementationAddress: "0x0000000000000000000000000000000000000002",
    });
  });

  it("preserves API failures instead of returning partial contract data", async () => {
    stubJSON({ status: "0", message: "NOTOK", result: "Max rate limit reached" });
    const provider = create("etherscan", { apiKey: "secret" });

    await expect(provider.getContractInfo(ADDRESS, "eth")).rejects.toBeInstanceOf(RateLimitError);
  });

  it("returns an empty history for Etherscan's no-transactions response", async () => {
    stubJSON({ status: "0", message: "No transactions found", result: [] });
    const provider = create("etherscan", { apiKey: "secret" });

    await expect(provider.getTxHistory(ADDRESS, "eth")).resolves.toEqual([]);
  });

  it("rejects networks that the unified endpoint does not serve", () => {
    expect(() => create("etherscan", { apiKey: "secret", defaultChain: "fantom" })).toThrow(
      UnsupportedChainError,
    );
  });
});
