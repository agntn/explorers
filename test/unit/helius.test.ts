import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthError,
  ExplorerError,
  NotFoundError,
  UnsupportedOperationError,
} from "../../src/core/errors.js";
import { create } from "../../src/core/registry.js";

const ADDRESS = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const SIGNATURE =
  "5h6xBEauJ3PK6SWCZ1PGjBvj8vDdWG3KpwATGy1ARAXFSDwt8GFXM7W5Ncn16wmqokgpiKRLuS83KUxyZyv2sUYv";

const USDC_ASSET = {
  interface: "FungibleToken",
  id: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  content: { metadata: { name: "USD Coin", symbol: "USDC" } },
  token_info: {
    balance: 12_500_000,
    decimals: 6,
    price_info: { price_per_token: 0.999_85, total_price: 12.498 },
  },
};

const SYSTEM_TRANSFER = {
  signature: SIGNATURE,
  slot: 148_277_128,
  timestamp: 1_656_442_333,
  fee: 5000,
  feePayer: ADDRESS,
  transactionError: null,
  instructions: [{ programId: "11111111111111111111111111111111" }],
};

/** A string body is served verbatim, which is the only way to test integers JSON.stringify rounds. */
function stubJSON(body: unknown) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  const fetch = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(text, { headers: { "Content-Type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

/** Answer each call with the next body, repeating the last one once the list runs out. */
function stubJSONPages(bodies: unknown[]) {
  let call = 0;
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
    const body = bodies[Math.min(call++, bodies.length - 1)];
    return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

/** A page of interchangeable spam mints. */
function spamPage(count: number) {
  const items = Array.from({ length: count }, (_, index) => ({
    interface: "FungibleToken",
    id: `spam${index}`,
    content: { metadata: { symbol: "SPAM" } },
    token_info: { balance: 1, decimals: 0 },
  }));
  return { jsonrpc: "2.0", id: "explorers", result: { items } };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("helius provider", () => {
  let provider: ReturnType<typeof create>;

  beforeEach(async () => {
    provider = await create("helius", { apiKey: "secret", baseUrl: "https://example.test/" });
  });

  it("requires a Helius API key", async () => {
    vi.stubEnv("HELIUS_API_KEY", "");
    await expect(create("helius")).rejects.toThrow(AuthError);
  });

  it("reports only explorer-backed capabilities", () => {
    expect(provider.capabilities).toEqual({
      balances: false,
      txHistory: true,
      txDetail: true,
      contractInfo: false,
      tokenBalances: true,
      tokenTransfers: false,
      gasData: false,
      blockInfo: false,
    });
    expect(provider.getGasData).toBeUndefined();
  });

  it("has no balance endpoint and says so", async () => {
    await expect(provider.getBalance(ADDRESS, "solana")).rejects.toThrow(UnsupportedOperationError);
  });

  it("maps enhanced transaction history with the api-key query param", async () => {
    const fetch = stubJSON([SYSTEM_TRANSFER]);

    await expect(provider.getTxHistory(ADDRESS, "solana", { limit: 3 })).resolves.toEqual([
      expect.objectContaining({
        hash: SIGNATURE,
        blockNumber: 148_277_128,
        from: ADDRESS,
        to: null,
        value: "0",
        fee: "5000",
        status: "success",
        isContractInteraction: false,
      }),
    ]);

    const [url] = fetch.mock.calls[0]!;
    expect(String(url)).toBe(
      `https://example.test/v0/addresses/${ADDRESS}/transactions?api-key=secret&limit=3`,
    );
  });

  it("marks non-system programs as contract interactions and errors as failed", async () => {
    stubJSON([
      {
        ...SYSTEM_TRANSFER,
        transactionError: { error: "custom" },
        instructions: [{ programId: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4" }],
      },
    ]);

    await expect(provider.getTxHistory(ADDRESS, "solana")).resolves.toEqual([
      expect.objectContaining({ status: "failed", isContractInteraction: true }),
    ]);
  });

  it("fetches one transaction through the parse endpoint", async () => {
    const fetch = stubJSON([SYSTEM_TRANSFER]);

    await expect(provider.getTxDetail!(SIGNATURE, "solana")).resolves.toMatchObject({
      hash: SIGNATURE,
      blockNumber: 148_277_128,
      status: "success",
    });

    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe("https://example.test/v0/transactions?api-key=secret");
    expect(JSON.parse(String(init?.body))).toEqual({ transactions: [SIGNATURE] });
  });

  it("throws NotFoundError when the parse endpoint returns no transaction", async () => {
    stubJSON([]);
    await expect(provider.getTxDetail!(SIGNATURE, "solana")).rejects.toThrow(NotFoundError);
  });

  it("maps fungible DAS assets to token balances", async () => {
    const fetch = stubJSON({ jsonrpc: "2.0", id: "explorers", result: { items: [USDC_ASSET] } });

    await expect(provider.getTokenBalances!(ADDRESS, "solana")).resolves.toEqual([
      {
        contract: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        symbol: "USDC",
        name: "USD Coin",
        decimals: 6,
        balance: "12500000",
        balanceFormatted: "12.5",
        priceUsd: 0.999_85,
        valueUsd: 12.498,
      },
    ]);

    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe("https://example.test/?api-key=secret");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      method: "searchAssets",
      params: { ownerAddress: ADDRESS, tokenType: "fungible", limit: 1000, page: 1 },
    });
  });

  it("keeps a balance past the safe integer range down to its last digit", async () => {
    stubJSON(
      '{"jsonrpc":"2.0","id":"explorers","result":{"items":[{"id":"mint","token_info":{"balance":5534023222112865480,"decimals":6}}]}}',
    );

    await expect(provider.getTokenBalances!(ADDRESS, "solana")).resolves.toMatchObject([
      { balance: "5534023222112865480", balanceFormatted: "5534023222112.86548" },
    ]);
  });

  it("falls back to the token program symbol and drops empty holdings on request", async () => {
    stubJSON({
      jsonrpc: "2.0",
      id: "explorers",
      result: {
        items: [
          USDC_ASSET,
          {
            interface: "FungibleAsset",
            id: "So11111111111111111111111111111111111111112",
            content: { metadata: { name: "Wrapped SOL" } },
            token_info: { balance: 0, decimals: 9, symbol: "wSOL" },
          },
        ],
      },
    });

    await expect(
      provider.getTokenBalances!(ADDRESS, "solana", { nonZeroOnly: false }),
    ).resolves.toMatchObject([{ symbol: "USDC" }, { symbol: "wSOL", balance: "0" }]);

    await expect(
      provider.getTokenBalances!(ADDRESS, "solana", { nonZeroOnly: true }),
    ).resolves.toHaveLength(1);
  });

  it("walks past the 1000-item page a spammed wallet fills", async () => {
    const fetch = stubJSONPages([spamPage(1000), spamPage(3)]);

    await expect(provider.getTokenBalances!(ADDRESS, "solana")).resolves.toHaveLength(1003);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetch.mock.calls[1]![1]?.body))).toMatchObject({
      params: { page: 2 },
    });
  });

  it("stops walking rather than following full pages without end", async () => {
    const fetch = stubJSONPages([spamPage(1000)]);

    await expect(provider.getTokenBalances!(ADDRESS, "solana")).resolves.toHaveLength(20_000);
    expect(fetch).toHaveBeenCalledTimes(20);
  });

  it("surfaces a JSON-RPC error instead of an empty holdings list", async () => {
    stubJSON({
      jsonrpc: "2.0",
      id: "explorers",
      error: { code: -32_602, message: "Validation Error: Invalid pubkey nope" },
    });

    await expect(provider.getTokenBalances!(ADDRESS, "solana")).rejects.toThrow(ExplorerError);

    stubJSON({ jsonrpc: "2.0", id: "explorers", result: null });
    await expect(provider.getTokenBalances!(ADDRESS, "solana")).rejects.toThrow(ExplorerError);
  });

  it("rejects non-Solana chains", async () => {
    await expect(provider.getTxHistory(ADDRESS, "ethereum")).rejects.toThrow();
    await expect(provider.getTokenBalances!(ADDRESS, "ethereum")).rejects.toThrow();
  });
});
