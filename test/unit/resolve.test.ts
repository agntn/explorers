import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  AuthError,
  HTTPError,
  NotFoundError,
  PlanRestrictedError,
  RateLimitError,
  TransportError,
  UnknownProviderError,
  UnsupportedOperationError,
} from "../../src/core/errors.ts";
import { forgetPlanLimits, resolveProvider, withProvider } from "../../src/core/resolve.ts";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  forgetPlanLimits();
});

function useNoProviderCredentials() {
  vi.stubEnv("ETHERSCAN_API_KEY", "");
  vi.stubEnv("BLOCKCHAIR_API_KEY", "");
  vi.stubEnv("SOLSCAN_API_KEY", "");
  vi.stubEnv("HELIUS_API_KEY", "");
  vi.stubEnv("TRONSCAN_API_KEY", "");
  vi.stubEnv("BLOCKBERRY_API_KEY", "");
  vi.stubEnv("WHATSONCHAIN_API_KEY", "");
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

  it("skips configured providers that cannot serve the requested capability", () => {
    useNoProviderCredentials();
    vi.stubEnv("HELIUS_API_KEY", "configured");

    expect(resolveProvider(undefined, "solana", "balances")).toBe("solscan");
    expect(resolveProvider(undefined, "solana", "txHistory")).toBe("helius");

    vi.stubEnv("SOLSCAN_API_KEY", "configured");
    expect(resolveProvider(undefined, "solana", "tokenBalances")).toBe("helius");
    expect(resolveProvider(undefined, "aptos", "balances")).toBe("aptos");
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
    expect(resolveProvider(undefined, "bitcoincash")).toBe("haskoin");
    expect(resolveProvider(undefined, "zcash")).toBe("blockchair");
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
    expect(resolveProvider(undefined, "arweave", "txHistory")).toBe("arweave");
    expect(resolveProvider(undefined, "arweave", "balances")).toBe("arweave");
    expect(resolveProvider(undefined, "arweave", "blockInfo")).toBe("arweave");
  });

  it("keeps Blockscout as the backstop for chains without a matching provider", () => {
    useNoProviderCredentials();

    expect(resolveProvider(undefined, "fantom")).toBe("blockscout");
    expect(resolveProvider(undefined, "fantom", "balances")).toBe("blockscout");
  });

  it("lets an explicit provider win over the requested chain and capability", () => {
    expect(resolveProvider("etherscan", "bitcoin")).toBe("etherscan");
    expect(resolveProvider("helius", "solana", "balances")).toBe("helius");
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

  it("starts on the chain an unambiguous address belongs to", async () => {
    useNoProviderCredentials();

    await expect(
      withProvider(
        undefined,
        undefined,
        async ({ chain, name }) => ({ chain, name }),
        "balances",
        "1AndrewYangForPresident2o2ozm6Pzd",
      ),
    ).resolves.toEqual({ chain: "bitcoin", name: "mempool" });
    await expect(
      withProvider(
        undefined,
        undefined,
        async ({ chain, name }) => ({ chain, name }),
        "balances",
        "bitcoincash:qz3yjg59ypg6jqpwhaxgvjj44jm4hdx0w5wsxw2qez",
      ),
    ).resolves.toEqual({ chain: "bitcoincash", name: "haskoin" });
    await expect(
      withProvider(
        undefined,
        undefined,
        async ({ chain, name }) => ({ chain, name }),
        "balances",
        "t1YQV51DKzKP63xJcynXuRfryMjfmgTJ7Jc",
      ),
    ).resolves.toEqual({ chain: "zcash", name: "blockchair" });
  });

  it("reads a legacy address as Bitcoin SV only when the chain or the provider says so", async () => {
    useNoProviderCredentials();
    const run = async ({ chain, name }: Readonly<{ chain: string; name: string }>) => ({
      chain,
      name,
    });
    const address = "1AndrewYangForPresident2o2ozm6Pzd";

    await expect(withProvider(undefined, "bitcoinsv", run, "balances", address)).resolves.toEqual({
      chain: "bitcoinsv",
      name: "whatsonchain",
    });
    await expect(
      withProvider("whatsonchain", undefined, run, "balances", address),
    ).resolves.toEqual({ chain: "bitcoinsv", name: "whatsonchain" });
    await expect(withProvider("mempool", undefined, run, "balances", address)).resolves.toEqual({
      chain: "bitcoin",
      name: "mempool",
    });
  });

  it("reads a Bitcoin Gold address through Blockbook without a chain", async () => {
    useNoProviderCredentials();
    const run = async ({ chain, name }: Readonly<{ chain: string; name: string }>) => ({
      chain,
      name,
    });

    await expect(
      withProvider(undefined, undefined, run, "utxos", "GNiT8AiCaMYPYW9uSgmq2qUsVjNgh1kdty"),
    ).resolves.toEqual({ chain: "bitcoingold", name: "blockbook" });
  });

  it("keeps Ethereum for an EVM address and an explicit chain over the address", async () => {
    useNoProviderCredentials();
    const run = async ({ chain }: Readonly<{ chain: string }>) => chain;

    await expect(
      withProvider(undefined, undefined, run, "balances", "0x" + "1".repeat(40)),
    ).resolves.toBe("ethereum");
    await expect(
      withProvider(undefined, "litecoin", run, "balances", "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy"),
    ).resolves.toBe("litecoin");
  });

  it("keeps an explicit provider's default chain", async () => {
    useNoProviderCredentials();
    vi.stubEnv("HELIUS_API_KEY", "configured");

    await expect(
      withProvider("helius", undefined, async ({ chain, name }) => ({ chain, name }), "balances"),
    ).resolves.toEqual({ chain: "solana", name: "helius" });
  });

  it("routes automatic balance reads away from Helius", async () => {
    useNoProviderCredentials();
    vi.stubEnv("HELIUS_API_KEY", "configured");
    const run = vi.fn();

    await expect(withProvider(undefined, "solana", run, "balances")).rejects.toMatchObject({
      name: AuthError.name,
      provider: "solscan",
    });
    expect(run).not.toHaveBeenCalled();
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

  it("falls back when the primary provider plan does not cover the read", async () => {
    useOnlyEtherscanCredentials();
    const tried: string[] = [];

    const selected = await withProvider(undefined, "ethereum", async ({ chain, name }) => {
      tried.push(name);
      if (name === "etherscan") throw new PlanRestrictedError(name);
      return { chain, name };
    });

    expect(tried).toEqual(["etherscan", "blockscout"]);
    expect(selected).toEqual({ chain: "ethereum", name: "blockscout" });
  });

  it.each([
    ["no response", new TransportError("connect ETIMEDOUT", undefined, "ETIMEDOUT", "mempool")],
    ["a 5xx", new HTTPError(503, "https://mempool.space/api/address/x", undefined, "mempool")],
  ])("falls back when the primary gives %s", async (_label, primaryError) => {
    useNoProviderCredentials();
    const tried: string[] = [];

    const name = await withProvider(undefined, "bitcoin", async ({ name }) => {
      tried.push(name);
      if (name === "mempool") throw primaryError;
      return name;
    });

    expect(tried).toEqual(["mempool", "blockstream"]);
    expect(name).toBe("blockstream");
  });

  it("does not fall back after a 4xx other than a rate limit", async () => {
    useNoProviderCredentials();
    const tried: string[] = [];

    await expect(
      withProvider(undefined, "bitcoin", async ({ name }) => {
        tried.push(name);
        throw new HTTPError(400, "https://mempool.space/api/address/x", undefined, name);
      }),
    ).rejects.toBeInstanceOf(HTTPError);
    expect(tried).toEqual(["mempool"]);
  });

  it("does not replace an explicitly selected provider that never answers", async () => {
    const tried: string[] = [];

    await expect(
      withProvider("mempool", "bitcoin", async ({ name }) => {
        tried.push(name);
        throw new TransportError("connect ETIMEDOUT", undefined, "ETIMEDOUT", name);
      }),
    ).rejects.toBeInstanceOf(TransportError);
    expect(tried).toEqual(["mempool"]);
  });

  it("does not fall back after the caller aborts the read", async () => {
    useNoProviderCredentials();
    const tried: string[] = [];

    await expect(
      withProvider(undefined, "bitcoin", async ({ name }) => {
        tried.push(name);
        throw new TransportError("This operation was aborted", undefined, "AbortError", name);
      }),
    ).rejects.toBeInstanceOf(TransportError);
    expect(tried).toEqual(["mempool"]);
  });

  it("keeps the primary failure as the cause when the fallback fails too", async () => {
    useNoProviderCredentials();
    const primaryError = new TransportError("connect ETIMEDOUT", undefined, "ETIMEDOUT", "mempool");
    const fallbackError = new HTTPError(502, "https://blockstream.info/api/x", undefined, "x");

    const rejection = withProvider(undefined, "bitcoin", async ({ name }) => {
      throw name === "mempool" ? primaryError : fallbackError;
    });

    await expect(rejection).rejects.toBe(fallbackError);
    expect(fallbackError.cause).toBe(primaryError);
  });

  it("retries Litecoin on Blockchair when litecoinspace.org fails", async () => {
    useNoProviderCredentials();
    const tried: string[] = [];

    const name = await withProvider(undefined, "litecoin", async ({ name }) => {
      tried.push(name);
      if (name === "mempool")
        throw new HTTPError(522, "https://litecoinspace.org/api/address/x", undefined, name);
      return name;
    });

    expect(tried).toEqual(["mempool", "blockchair"]);
    expect(name).toBe("blockchair");
  });

  it("retries Bitcoin on keyless Blockstream before keyless Blockchair", async () => {
    useNoProviderCredentials();
    const tried: string[] = [];

    await withProvider(undefined, "bitcoin", async ({ name }) => {
      tried.push(name);
      if (name === "mempool") throw new RateLimitError(name);
      return name;
    });

    expect(tried).toEqual(["mempool", "blockstream"]);
  });

  it("retries Bitcoin Cash on keyless Haskoin when a keyed Blockchair is blocked", async () => {
    useNoProviderCredentials();
    vi.stubEnv("BLOCKCHAIR_API_KEY", "configured");
    const tried: string[] = [];

    const name = await withProvider(undefined, "bitcoincash", async ({ name }) => {
      tried.push(name);
      if (name === "blockchair") throw new RateLimitError(name);
      return name;
    });

    expect(tried).toEqual(["blockchair", "haskoin"]);
    expect(name).toBe("haskoin");
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
      withProvider("blockscout", "ethereum", async ({ name }) => {
        tried.push(name);
        throw new RateLimitError(name);
      }),
    ).rejects.toBeInstanceOf(RateLimitError);
    expect(tried).toEqual(["blockscout"]);
  });

  it("does not replace an explicitly selected plan-restricted provider", async () => {
    const tried: string[] = [];

    await expect(
      withProvider("blockscout", "ethereum", async ({ name }) => {
        tried.push(name);
        throw new PlanRestrictedError(name);
      }),
    ).rejects.toBeInstanceOf(PlanRestrictedError);
    expect(tried).toEqual(["blockscout"]);
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

describe("plan limits", () => {
  function readBalance(
    chain: "base" | "bsc" | "ethereum",
    /* oxlint-disable-next-line typescript/prefer-readonly-parameter-types */
    tried: string[],
    failing: readonly string[],
  ) {
    return withProvider(
      undefined,
      chain,
      async ({ name }) => {
        tried.push(name);
        if (name === "etherscan") throw new PlanRestrictedError(name);
        if (failing.includes(name)) throw new HTTPError(503, "https://x", undefined, name);
        return name;
      },
      "balances",
    );
  }

  it("asks the refused provider last on the next automatic read", async () => {
    useOnlyEtherscanCredentials();
    const tried: string[] = [];

    await readBalance("base", tried, []);
    await readBalance("base", tried, []);

    expect(tried).toEqual(["etherscan", "blockscout", "blockscout"]);
  });

  it("remembers a refusal per chain and operation", async () => {
    useOnlyEtherscanCredentials();
    await readBalance("base", [], []);
    const tried: string[] = [];

    await readBalance("ethereum", tried, []);
    await withProvider(
      undefined,
      "base",
      async ({ name }) => {
        tried.push(name);
        return name;
      },
      "tokenBalances",
    );

    expect(tried).toEqual(["etherscan", "blockscout", "etherscan"]);
  });

  it("does not fall back to a provider that refused the read before", async () => {
    useOnlyEtherscanCredentials();
    await readBalance("base", [], []);
    const tried: string[] = [];

    await expect(readBalance("base", tried, ["blockscout"])).rejects.toBeInstanceOf(HTTPError);
    expect(tried).toEqual(["blockscout"]);
  });

  it("still asks the refused provider when nobody else serves the chain", async () => {
    useOnlyEtherscanCredentials();
    const tried: string[] = [];

    await expect(readBalance("bsc", tried, [])).rejects.toBeInstanceOf(PlanRestrictedError);
    await expect(readBalance("bsc", tried, [])).rejects.toBeInstanceOf(PlanRestrictedError);
    expect(tried).toEqual(["etherscan", "etherscan"]);
  });

  it("keeps asking a provider the caller names", async () => {
    useOnlyEtherscanCredentials();
    await readBalance("base", [], []);
    const tried: string[] = [];

    await withProvider("etherscan", "base", async ({ name }) => {
      tried.push(name);
      return name;
    });

    expect(tried).toEqual(["etherscan"]);
  });

  it("does not remember a refusal from a provider the caller names", async () => {
    useOnlyEtherscanCredentials();
    await expect(
      withProvider(
        "etherscan",
        "base",
        async ({ name }) => {
          throw new PlanRestrictedError(name);
        },
        "balances",
      ),
    ).rejects.toBeInstanceOf(PlanRestrictedError);
    const tried: string[] = [];

    await readBalance("base", tried, []);

    expect(tried).toEqual(["etherscan", "blockscout"]);
  });

  it("does not remember a refusal from a read without a capability", async () => {
    useOnlyEtherscanCredentials();
    const tried: string[] = [];
    const readAny = () =>
      withProvider(undefined, "base", async ({ name }) => {
        tried.push(name);
        if (name === "etherscan") throw new PlanRestrictedError(name);
        return name;
      });

    await readAny();
    await readAny();

    expect(tried).toEqual(["etherscan", "blockscout", "etherscan", "blockscout"]);
  });

  it("keeps the refusal with the key that earned it", async () => {
    useOnlyEtherscanCredentials();
    await withProvider(
      undefined,
      "base",
      async ({ name }) => {
        if (name === "etherscan") {
          vi.stubEnv("ETHERSCAN_API_KEY", "upgraded");
          throw new PlanRestrictedError(name);
        }
        return name;
      },
      "balances",
    );
    const tried: string[] = [];

    await readBalance("base", tried, []);

    expect(tried).toEqual(["etherscan", "blockscout"]);
  });

  it("forgets the refusal when the key changes", async () => {
    useOnlyEtherscanCredentials();
    await readBalance("base", [], []);
    vi.stubEnv("ETHERSCAN_API_KEY", "upgraded");
    const tried: string[] = [];

    await readBalance("base", tried, []);

    expect(tried).toEqual(["etherscan", "blockscout"]);
  });

  it("forgets the refusal after an hour", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    useOnlyEtherscanCredentials();
    await readBalance("base", [], []);
    const tried: string[] = [];

    vi.advanceTimersByTime(59 * 60 * 1000);
    await readBalance("base", tried, []);
    vi.advanceTimersByTime(2 * 60 * 1000);
    await readBalance("base", tried, []);

    expect(tried).toEqual(["blockscout", "etherscan", "blockscout"]);
  });
});
