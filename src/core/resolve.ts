/** Auto-select providers by environment, chain, and operation capability. */

import { create, providers, has, supportsCapability, supportsChain } from "./registry.js";
import {
  AuthError,
  PlanRestrictedError,
  RateLimitError,
  UnknownProviderError,
  UnsupportedChainError,
  UnsupportedOperationError,
} from "./errors.js";
import type { Provider, ProviderCapability } from "./provider.js";
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
  arweave: [],
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
  arweave: "arweave",
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
  capability?: ProviderCapability,
): readonly string[] {
  const fitsChain = chain === undefined || supportsChain(name, chain);
  const fitsCapability = capability === undefined || supportsCapability(name, capability);
  return has(name) && fitsChain && fitsCapability && !ranked.includes(name)
    ? [...ranked, name]
    : ranked;
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
  capability?: ProviderCapability,
): readonly string[] {
  let result = ranked;
  for (const name of candidates) result = appendRankedProvider(result, name, chain, capability);
  return result;
}

function rankProviders(
  chain?: ChainKey,
  mode: "primary" | "fallback" = "primary",
  capability?: ProviderCapability,
): string[] {
  let ranked = appendCandidates([], configuredProviderNames(), chain, capability);
  ranked = appendCandidates(ranked, keylessProviderNames(mode), chain, capability);
  if (mode === "primary" && chain !== undefined) {
    ranked = appendCandidates(ranked, providers(), chain, capability);
  }
  return [...ranked];
}

/**
 * Choose a registered provider for the current environment.
 *
 * An explicit preference wins, even for a chain it cannot serve, so misconfiguration stays visible.
 * Without one, candidates that declare support for the requested chain and optional capability are
 * considered in order: configured credentials first, then keyless providers, then any matching
 * registry entry, and finally Blockscout when no provider matches the chain.
 *
 * @throws {UnknownProviderError} When an explicit preference is not registered.
 *
 * @param {string} preferred - The `preferred` value.
 * @param {ChainKey} chain - The `chain` value.
 * @param {ProviderCapability} capability - Operation required from an automatic selection.
 * @returns {string} The resulting value.
 */
export function resolveProvider(
  preferred?: string,
  chain?: ChainKey,
  capability?: ProviderCapability,
): string {
  if (preferred !== undefined) {
    if (!has(preferred)) throw new UnknownProviderError(preferred);
    return preferred;
  }

  const selected = rankProviders(chain, "primary", capability)[0];
  if (selected !== undefined) return selected;

  // If no backend serves the operation, preserve chain-aware selection so its typed limitation
  // stays more useful than an unrelated provider's chain error.
  if (capability !== undefined) {
    const chainMatch = rankProviders(chain)[0];
    if (chainMatch !== undefined) return chainMatch;
  }

  return has("blockscout") ? "blockscout" : (providers()[0] ?? "blockscout");
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
 * Run one read with provider selection and one automatic retry after a transient or plan limit.
 *
 * When neither provider nor chain is explicit, selection starts on Ethereum. An explicit provider
 * without a chain keeps that provider's default chain. The callback must be safe to run twice.
 *
 * @param {string | undefined} preferred - The `preferred` value.
 * @param {ChainKey | undefined} chain - The `chain` value.
 * @param {(context: Readonly<ProviderContext>) => Promise<T>} run - The `run` value.
 * @param {ProviderCapability} capability - Operation required from an automatic selection.
 * @returns {Promise<T>} The resulting value.
 */
export async function withProvider<T>(
  preferred: string | undefined,
  chain: ChainKey | undefined,
  /* oxlint-disable-next-line typescript/prefer-readonly-parameter-types */
  run: (context: ProviderContext) => Promise<T>,
  capability?: ProviderCapability,
): Promise<T> {
  const requestedChain = chain ?? (preferred === undefined ? normalizeChain() : undefined);
  const primaryName = resolveProvider(preferred, requestedChain, capability);
  const effectiveChain = requestedChain ?? normalizeChain(PROVIDER_DEFAULT_CHAIN[primaryName]);
  const fallbackName = rankProviders(effectiveChain, "fallback", capability).find(
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
      !(error instanceof RateLimitError || error instanceof PlanRestrictedError)
    ) {
      throw error;
    }

    return runFallback(execute, fallbackName, error);
  }
}
