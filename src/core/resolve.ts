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

function hasConfiguredCredentials(envKeys: readonly string[]): boolean {
  return envKeys.length > 0 && envKeys.every((key) => process.env[key]);
}

function isKeylessCandidate(
  name: string,
  envKeys: readonly string[],
  mode: "primary" | "fallback",
): boolean {
  return (
    envKeys.length === 0 || (mode === "fallback" && OPTIONAL_CREDENTIAL_PROVIDERS.includes(name))
  );
}

function appendRankedProvider(
  ranked: readonly string[],
  name: string,
  chain?: ChainKey,
): readonly string[] {
  const fits = chain === undefined || supportsChain(name, chain);
  return has(name) && fits && !ranked.includes(name) ? [...ranked, name] : ranked;
}

function configuredProviderNames(): string[] {
  return Object.entries(ENV_MAP)
    .filter(([, envKeys]) => hasConfiguredCredentials(envKeys))
    .map(([name]) => name);
}

function keylessProviderNames(mode: "primary" | "fallback"): string[] {
  return Object.entries(ENV_MAP)
    .filter(([name, envKeys]) => isKeylessCandidate(name, envKeys, mode))
    .map(([name]) => name);
}

function appendCandidates(
  ranked: readonly string[],
  candidates: readonly string[],
  chain?: ChainKey,
): readonly string[] {
  let result = ranked;
  for (const name of candidates) result = appendRankedProvider(result, name, chain);
  return result;
}

function rankProviders(chain?: ChainKey, mode: "primary" | "fallback" = "primary"): string[] {
  let ranked = appendCandidates([], configuredProviderNames(), chain);
  ranked = appendCandidates(ranked, keylessProviderNames(mode), chain);
  if (mode === "primary" && chain !== undefined) {
    ranked = appendCandidates(ranked, providers(), chain);
  }
  if (ranked.length === 0 && has("blockscout")) ranked = ["blockscout"];
  return [...ranked];
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
 *
 * @param {string} preferred - The `preferred` value.
 * @param {ChainKey} chain - The `chain` value.
 * @returns {string} The resulting value.
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
  readonly chain: ChainKey;
  readonly name: string;
  readonly provider: Provider;
}

function preservesPrimaryError(error: unknown): boolean {
  return (
    error instanceof AuthError ||
    error instanceof UnsupportedChainError ||
    error instanceof UnsupportedOperationError
  );
}

async function runFallback<T>(
  execute: (name: string) => Promise<T>,
  fallbackName: string,
  primaryError: unknown,
): Promise<T> {
  try {
    return await execute(fallbackName);
  } catch (fallbackError) {
    if (preservesPrimaryError(fallbackError)) throw primaryError;
    throw fallbackError;
  }
}

/**
 * Run one read with provider selection and one automatic retry after a rate limit.
 *
 * When neither provider nor chain is explicit, selection starts on Ethereum. An explicit provider
 * without a chain keeps that provider's default chain. The callback must be safe to run twice.
 *
 * @param {string | undefined} preferred - The `preferred` value.
 * @param {ChainKey | undefined} chain - The `chain` value.
 * @param {(context: Readonly<ProviderContext>) => Promise<T>} run - The `run` value.
 * @returns {Promise<T>} The resulting value.
 */
export async function withProvider<T>(
  preferred: string | undefined,
  chain: ChainKey | undefined,
  /* oxlint-disable-next-line typescript/prefer-readonly-parameter-types */
  run: (context: ProviderContext) => Promise<T>,
): Promise<T> {
  const requestedChain = chain ?? (preferred === undefined ? normalizeChain() : undefined);
  const primaryName = resolveProvider(preferred, requestedChain);
  const effectiveChain = requestedChain ?? normalizeChain(PROVIDER_DEFAULT_CHAIN[primaryName]);
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

    return runFallback(execute, fallbackName, error);
  }
}
