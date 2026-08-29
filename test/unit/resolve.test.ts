import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NotFoundError,
  RateLimitError,
  UnknownProviderError,
  UnsupportedOperationError,
} from "../../src/core/errors.js";
import { resolveProvider, withProvider } from "../../src/core/resolve.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

function useNoProviderCredentials() {
  vi.stubEnv("ETHERSCAN_API_KEY", "");
  vi.stubEnv("BLOCKCHAIR_API_KEY", "");
  vi.stubEnv("SOLSCAN_API_KEY", "");
  vi.stubEnv("HELIUS_API_KEY", "");
  vi.stubEnv("TRONSCAN_API_KEY", "");
  vi.stubEnv("BLOCKBERRY_API_KEY", "");
}

function useOnlyEtherscanCredentials() {
  useNoProviderCredentials();
  vi.stubEnv("ETHERSCAN_API_KEY", "configured");
}

describe("resolveProvider", () => {
  it("honors an explicitly registered provider", () => {
    expect(resolveProvider("mempool")).toBe("mempool");
  });

  it.each(["", "missing"])("rejects an unknown explicit provider", (provider) => {
    expect(() => resolveProvider(provider)).toThrow(UnknownProviderError);
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
    expect(resolveProvider(undefined, "pepecoin")).toBe("mempool");
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
    expect(resolveProvider(undefined, "cardano")).toBe("koios");
  });

  it("lets an explicit provider win over the requested chain", () => {
    expect(resolveProvider("etherscan", "bitcoin")).toBe("etherscan");
  });
});

describe("withProvider", () => {
  it("defaults automatic reads to Ethereum despite credentials for another chain", async () => {
    useNoProviderCredentials();
    vi.stubEnv("HELIUS_API_KEY", "configured");

    await expect(
      withProvider(undefined, undefined, async ({ chain, name }) => ({ chain, name })),
    ).resolves.toEqual({ chain: "ethereum", name: "blockscout" });
  });

  it("keeps an explicit provider's default chain", async () => {
    useNoProviderCredentials();
    vi.stubEnv("HELIUS_API_KEY", "configured");

    await expect(
      withProvider("helius", undefined, async ({ chain, name }) => ({ chain, name })),
    ).resolves.toEqual({ chain: "solana", name: "helius" });
  });

  it("keeps the primary chain when a rate limit triggers fallback", async () => {
    useOnlyEtherscanCredentials();
    const tried: string[] = [];

    const selected = await withProvider(undefined, undefined, async ({ chain, name }) => {
      tried.push(name);
      if (name === "etherscan") throw new RateLimitError(name);
      return { chain, name };
    });

    expect(tried).toEqual(["etherscan", "blockscout"]);
    expect(selected).toEqual({ chain: "ethereum", name: "blockscout" });
  });

  it("uses a provider with optional credentials after the keyless default", async () => {
    useNoProviderCredentials();
    const tried: string[] = [];

    const name = await withProvider(undefined, "ethereum", async ({ name }) => {
      tried.push(name);
      if (name === "blockscout") throw new RateLimitError(name);
      return name;
    });

    expect(tried).toEqual(["blockscout", "blockchair"]);
    expect(name).toBe("blockchair");
  });

  it("does not replace an explicitly selected provider", async () => {
    const tried: string[] = [];

    await expect(
      withProvider("etherscan", "ethereum", async ({ name }) => {
        tried.push(name);
        throw new RateLimitError(name);
      }),
    ).rejects.toBeInstanceOf(RateLimitError);
    expect(tried).toEqual(["etherscan"]);
  });

  it("keeps the original rate limit when fallback cannot serve the operation", async () => {
    useNoProviderCredentials();
    vi.stubEnv("SOLSCAN_API_KEY", "configured");
    vi.stubEnv("HELIUS_API_KEY", "configured");
    const primaryError = new RateLimitError("solscan");
    const tried: string[] = [];

    await expect(
      withProvider(undefined, "solana", async ({ name }) => {
        tried.push(name);
        if (name === "solscan") throw primaryError;
        throw new UnsupportedOperationError("getBalance", name);
      }),
    ).rejects.toBe(primaryError);
    expect(tried).toEqual(["solscan", "helius"]);
  });

  it("does not retry failures other than rate limits", async () => {
    useOnlyEtherscanCredentials();
    const tried: string[] = [];

    await expect(
      withProvider(undefined, "ethereum", async ({ name }) => {
        tried.push(name);
        throw new NotFoundError("balance", name);
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(tried).toEqual(["etherscan"]);
  });

  it("tries only one fallback provider", async () => {
    useOnlyEtherscanCredentials();
    const tried: string[] = [];

    await expect(
      withProvider(undefined, "ethereum", async ({ name }) => {
        tried.push(name);
        throw new RateLimitError(name);
      }),
    ).rejects.toBeInstanceOf(RateLimitError);
    expect(tried).toEqual(["etherscan", "blockscout"]);
  });
});
