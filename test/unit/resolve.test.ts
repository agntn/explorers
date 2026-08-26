import { afterEach, describe, expect, it, vi } from "vitest";
import { UnknownProviderError } from "../../src/core/errors.js";
import { resolveProvider } from "../../src/core/resolve.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveProvider", () => {
  it("honors an explicitly registered provider", () => {
    expect(resolveProvider("mempool")).toBe("mempool");
  });

  it("rejects an unknown explicit provider", () => {
    expect(() => resolveProvider("missing")).toThrow(UnknownProviderError);
  });

  it("prefers configured credentials before the free fallback", () => {
    vi.stubEnv("ETHERSCAN_API_KEY", "");
    vi.stubEnv("BLOCKCHAIR_API_KEY", "configured");
    vi.stubEnv("SOLSCAN_API_KEY", "");
    vi.stubEnv("HELIUS_API_KEY", "");
    vi.stubEnv("TRONSCAN_API_KEY", "");
    vi.stubEnv("BLOCKBERRY_API_KEY", "");

    expect(resolveProvider()).toBe("blockchair");
  });

  it("defaults to Blockscout when no credentials are configured", () => {
    vi.stubEnv("ETHERSCAN_API_KEY", "");
    vi.stubEnv("BLOCKCHAIR_API_KEY", "");
    vi.stubEnv("SOLSCAN_API_KEY", "");
    vi.stubEnv("HELIUS_API_KEY", "");
    vi.stubEnv("TRONSCAN_API_KEY", "");
    vi.stubEnv("BLOCKBERRY_API_KEY", "");

    expect(resolveProvider()).toBe("blockscout");
  });

  it("skips a configured provider that cannot serve the requested chain", () => {
    vi.stubEnv("ETHERSCAN_API_KEY", "configured");
    vi.stubEnv("BLOCKCHAIR_API_KEY", "");
    vi.stubEnv("SOLSCAN_API_KEY", "");
    vi.stubEnv("HELIUS_API_KEY", "");
    vi.stubEnv("TRONSCAN_API_KEY", "");
    vi.stubEnv("BLOCKBERRY_API_KEY", "");

    expect(resolveProvider(undefined, "bitcoin")).toBe("mempool");
    expect(resolveProvider(undefined, "litecoin")).toBe("mempool");
  });

  it("keeps a configured provider that serves the requested chain", () => {
    vi.stubEnv("ETHERSCAN_API_KEY", "configured");
    vi.stubEnv("BLOCKCHAIR_API_KEY", "");
    vi.stubEnv("SOLSCAN_API_KEY", "");
    vi.stubEnv("HELIUS_API_KEY", "");
    vi.stubEnv("TRONSCAN_API_KEY", "");
    vi.stubEnv("BLOCKBERRY_API_KEY", "");

    expect(resolveProvider(undefined, "ethereum")).toBe("etherscan");
  });

  it("prefers configured credentials among chain-capable providers", () => {
    vi.stubEnv("ETHERSCAN_API_KEY", "");
    vi.stubEnv("BLOCKCHAIR_API_KEY", "");
    vi.stubEnv("SOLSCAN_API_KEY", "");
    vi.stubEnv("HELIUS_API_KEY", "configured");
    vi.stubEnv("TRONSCAN_API_KEY", "");
    vi.stubEnv("BLOCKBERRY_API_KEY", "");

    expect(resolveProvider(undefined, "solana")).toBe("helius");
  });

  it("falls back to a chain-capable provider even without credentials", () => {
    vi.stubEnv("ETHERSCAN_API_KEY", "");
    vi.stubEnv("BLOCKCHAIR_API_KEY", "");
    vi.stubEnv("SOLSCAN_API_KEY", "");
    vi.stubEnv("HELIUS_API_KEY", "");
    vi.stubEnv("TRONSCAN_API_KEY", "");
    vi.stubEnv("BLOCKBERRY_API_KEY", "");

    expect(resolveProvider(undefined, "solana")).toBe("solscan");
    expect(resolveProvider(undefined, "ecash")).toBe("blockchair");
  });

  it("routes keyless single-chain networks to their explorer", () => {
    vi.stubEnv("ETHERSCAN_API_KEY", "");
    vi.stubEnv("BLOCKCHAIR_API_KEY", "");
    vi.stubEnv("SOLSCAN_API_KEY", "");
    vi.stubEnv("HELIUS_API_KEY", "");
    vi.stubEnv("TRONSCAN_API_KEY", "");
    vi.stubEnv("BLOCKBERRY_API_KEY", "");

    expect(resolveProvider(undefined, "ton")).toBe("ton");
    expect(resolveProvider(undefined, "aptos")).toBe("aptos");
  });

  it("lets an explicit provider win over the requested chain", () => {
    expect(resolveProvider("etherscan", "bitcoin")).toBe("etherscan");
  });
});
