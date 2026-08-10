/**
 * Auto-select provider by checking env vars
 */

import { providers, has } from "./registry.js";
import { UnknownProviderError } from "./errors.js";
import type { Chain } from "./types.js";

const ENV_MAP: Record<string, string[]> = {
  etherscan: ["ETHERSCAN_API_KEY"],
  blockscout: [],
  blockchair: ["BLOCKCHAIR_API_KEY"],
  mempool: [],
  solana: [],
  ton: [],
  tron: [],
  aptos: [],
  sui: [],
};

/** Provider-specific default chains */
export const PROVIDER_DEFAULT_CHAIN: Partial<Record<string, Chain>> = {
  mempool: "bitcoin",
  solana: "solana",
  ton: "ton",
  tron: "tron",
  aptos: "aptos",
  sui: "sui",
};

/**
 * Choose a registered provider for the current environment.
 *
 * An explicit preference wins. Without one, a provider with configured credentials
 * is selected first, followed by Blockscout and then the first registry entry.
 *
 * @throws {UnknownProviderError} When an explicit preference is not registered.
 */
export function resolveProvider(preferred?: string): string {
  if (preferred) {
    if (!has(preferred)) {
      throw new UnknownProviderError(preferred);
    }
    return preferred;
  }

  // Pick first provider whose env keys are all set
  for (const [name, envKeys] of Object.entries(ENV_MAP)) {
    if (!has(name)) continue;
    if (envKeys.length === 0) continue;
    const allSet = envKeys.every((k) => process.env[k]);
    if (allSet) return name;
  }

  // Default: blockscout (no key needed)
  if (has("blockscout")) return "blockscout";

  return providers()[0] ?? "blockscout";
}
