/** Auto-select provider by checking env vars */

import { create, providers, has, supportsChain } from "./registry.js";
import {
  AuthError,
  RateLimitError,
  UnknownProviderError,
  UnsupportedChainError,
  UnsupportedOperationError,
} from "./errors.js";
import type { Provider } from "./provider.js";
import { normalizeChain } from "./types.js";
import type { ChainKey } from "./types.js";

const ENV_MAP: Record<string, string[]> = {
  etherscan: ["ETHERSCAN_API_KEY"],
  blockscout: [],
  blockchair: ["BLOCKCHAIR_API_KEY"],
  mempool: [],
  blockstream: [],
  solscan: ["SOLSCAN_API_KEY"],
  helius: ["HELIUS_API_KEY"],
  ton: [],
  tronscan: ["TRONSCAN_API_KEY"],
  aptos: [],
  blockberry: ["BLOCKBERRY_API_KEY"],
  koios: [],
};

const OPTIONAL_CREDENTIAL_PROVIDERS: readonly string[] = ["blockchair"];

/** Provider-specific default chains */
export const PROVIDER_DEFAULT_CHAIN: Partial<Record<string, ChainKey>> = {
  mempool: "bitcoin",
  blockstream: "bitcoin",
  solscan: "solana",
  helius: "solana",
  ton: "ton",
  tronscan: "tron",
  aptos: "aptos",
  blockberry: "sui",
  koios: "cardano",
};

function rankProviders(chain?: ChainKey, mode: "primary" | "fallback" = "primary"): string[] {
  const fits = (name: string) => chain === undefined || supportsChain(name, chain);
  const ranked: string[] = [];
  const add = (name: string) => {
    if (has(name) && fits(name) && !ranked.includes(name)) ranked.push(name);
  };

  for (const [name, envKeys] of Object.entries(ENV_MAP)) {
    if (envKeys.length > 0 && envKeys.every((key) => process.env[key])) add(name);
  }

  for (const [name, envKeys] of Object.entries(ENV_MAP)) {
    if (
      envKeys.length === 0 ||
      (mode === "fallback" && OPTIONAL_CREDENTIAL_PROVIDERS.includes(name))
    ) {
      add(name);
    }
  }

  if (mode === "primary" && chain !== undefined) {
    for (const name of providers()) add(name);
  }

  if (ranked.length === 0 && has("blockscout")) ranked.push("blockscout");
  return ranked;
}

/**
 * Choose a registered provider for the current environment.
 *
 * An explicit preference wins, even for a chain it cannot serve, so misconfiguration stays visible.
 * Without one, candidates that declare support for the requested chain are considered in order:
 * configured credentials first, then keyless providers, then any chain-capable registry entry, and
 * finally Blockscout.
 *
 * @throws {UnknownProviderError} When an explicit preference is not registered.
 */
export function resolveProvider(preferred?: string, chain?: ChainKey): string {
  if (preferred !== undefined) {
    if (!has(preferred)) throw new UnknownProviderError(preferred);
    return preferred;
  }

  return rankProviders(chain)[0] ?? providers()[0] ?? "blockscout";
}

/** Provider and effective chain selected for one read. */
export interface ProviderContext {
  chain: ChainKey;
  name: string;
  provider: Provider;
}

/** Retry one automatic read after a rate limit. The callback must be safe to run twice. */
export async function withProvider<T>(
  preferred: string | undefined,
  chain: ChainKey | undefined,
  run: (context: ProviderContext) => Promise<T>,
): Promise<T> {
  const primaryName = resolveProvider(preferred, chain);
  const effectiveChain = chain ?? normalizeChain(PROVIDER_DEFAULT_CHAIN[primaryName]);
  const fallbackName = rankProviders(effectiveChain, "fallback").find(
    (name) => name !== primaryName,
  );
  const execute = async (name: string) =>
    run({ chain: effectiveChain, name, provider: await create(name) });

  try {
    return await execute(primaryName);
  } catch (error) {
    if (
      preferred !== undefined ||
      fallbackName === undefined ||
      !(error instanceof RateLimitError)
    ) {
      throw error;
    }

    try {
      return await execute(fallbackName);
    } catch (fallbackError) {
      if (
        fallbackError instanceof AuthError ||
        fallbackError instanceof UnsupportedChainError ||
        fallbackError instanceof UnsupportedOperationError
      ) {
        throw error;
      }
      throw fallbackError;
    }
  }
}
