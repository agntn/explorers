/** Auto-select provider by checking env vars */

import { providers, has, supportsChain } from "./registry.js";
import { UnknownProviderError } from "./errors.js";
import type { ChainKey } from "./types.js";

const ENV_MAP: Record<string, string[]> = {
  etherscan: ["ETHERSCAN_API_KEY"],
  blockscout: [],
  blockchair: ["BLOCKCHAIR_API_KEY"],
  mempool: [],
  solscan: ["SOLSCAN_API_KEY"],
  helius: ["HELIUS_API_KEY"],
  ton: [],
  tronscan: ["TRONSCAN_API_KEY"],
  aptos: [],
  blockberry: ["BLOCKBERRY_API_KEY"],
  koios: [],
};

/** Provider-specific default chains */
export const PROVIDER_DEFAULT_CHAIN: Partial<Record<string, ChainKey>> = {
  mempool: "bitcoin",
  solscan: "solana",
  helius: "solana",
  ton: "ton",
  tronscan: "tron",
  aptos: "aptos",
  blockberry: "sui",
  koios: "cardano",
};

/**
 * Choose a registered provider for the current environment.
 *
 * An explicit preference wins, even for a chain it cannot serve, so misconfiguration stays
 * visible. Without one, candidates that declare support for the requested chain are considered
 * in order: configured credentials first, then keyless providers, then any chain-capable
 * registry entry, and finally Blockscout.
 *
 * @throws {UnknownProviderError} When an explicit preference is not registered.
 */
export function resolveProvider(preferred?: string, chain?: ChainKey): string {
  if (preferred) {
    if (!has(preferred)) {
      throw new UnknownProviderError(preferred);
    }
    return preferred;
  }

  const fits = (name: string) => chain === undefined || supportsChain(name, chain);

  // Pick first provider whose env keys are all set
  for (const [name, envKeys] of Object.entries(ENV_MAP)) {
    if (!has(name) || !fits(name)) continue;
    if (envKeys.length === 0) continue;
    const allSet = envKeys.every((k) => process.env[k]);
    if (allSet) return name;
  }

  // Keyless providers next, so bitcoin lands on mempool and ton on TONAPI
  for (const [name, envKeys] of Object.entries(ENV_MAP)) {
    if (envKeys.length > 0) continue;
    if (has(name) && fits(name)) return name;
  }

  // A chain-capable provider missing credentials fails with a clearer error than a chain mismatch
  if (chain !== undefined) {
    for (const name of providers()) {
      if (supportsChain(name, chain)) return name;
    }
  }

  // Default: blockscout (no key needed)
  if (has("blockscout")) return "blockscout";

  return providers()[0] ?? "blockscout";
}
