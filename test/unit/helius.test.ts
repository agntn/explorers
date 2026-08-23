import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError, NotFoundError, UnsupportedOperationError } from "../../src/core/errors.js";
import { create } from "../../src/core/registry.js";
import "../../src/providers/helius.js";

const ADDRESS = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const SIGNATURE =
  "5h6xBEauJ3PK6SWCZ1PGjBvj8vDdWG3KpwATGy1ARAXFSDwt8GFXM7W5Ncn16wmqokgpiKRLuS83KUxyZyv2sUYv";

const SYSTEM_TRANSFER = {
  signature: SIGNATURE,
  slot: 148_277_128,
  timestamp: 1_656_442_333,
  fee: 5000,
  feePayer: ADDRESS,
  transactionError: null,
  instructions: [{ programId: "11111111111111111111111111111111" }],
};

function stubJSON(body: unknown) {
  const fetch = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("helius provider", () => {
  let provider: ReturnType<typeof create>;

  beforeEach(() => {
    provider = create("helius", { apiKey: "secret", baseUrl: "https://example.test/" });
  });

  it("requires a Helius API key", () => {
    vi.stubEnv("HELIUS_API_KEY", "");
    expect(() => create("helius")).toThrow(AuthError);
  });

  it("reports only explorer-backed capabilities", () => {
    expect(provider.capabilities).toEqual({
      balances: false,
      txHistory: true,
      txDetail: true,
      contractInfo: false,
      tokenBalances: false,
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

  it("rejects non-Solana chains", async () => {
    await expect(provider.getTxHistory(ADDRESS, "eth")).rejects.toThrow();
  });
});
