/** Auto-select providers by environment, chain, and operation capability. */

import { create, providers, has, supportsCapability, supportsChain } from "./registry.js";
import {
  AuthError,
  HTTPError,
  PlanRestrictedError,
  RateLimitError,
  TransportError,
  UnknownProviderError,
  UnsupportedChainError,
  UnsupportedOperationError,
} from "./errors.js";
import { inferChain } from "./input.js";
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
  dcrdata: [],
  horizon: [],
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
  dcrdata: "decred",
  horizon: "stellar",
};

function hasConfiguredCredentials(envKeys: readonly string[]): boolean {
  return envKeys.length > 0 && envKeys.every((key) => process.env[key]);
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

/* A provider that merely tolerates a missing key throttles hard without one, so it ranks last. */
function keylessProviderNames(mode: "primary" | "fallback"): string[] {
  const keyless = Object.entries(ENV_MAP)
    .filter(([, envKeys]) => envKeys.length === 0)
    .map(([name]) => name);
  return mode === "fallback" ? [...keyless, ...OPTIONAL_CREDENTIAL_PROVIDERS] : keyless;
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

/* Failures another backend may not share: limits, no response, or a server error. A caller's
   abort is a decision, not an outage, so it never moves the read. */
function isTransientFailure(error: unknown): boolean {
  return (
    error instanceof RateLimitError ||
    error instanceof PlanRestrictedError ||
    (error instanceof TransportError && error.code !== "AbortError") ||
    (error instanceof HTTPError && error.statusCode >= 500)
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
    if (
      fallbackError instanceof Error &&
      fallbackError !== primaryError &&
      fallbackError.cause === undefined
    ) {
      fallbackError.cause = primaryError;
    }
    throw fallbackError;
  }
}

function startingChain(
  preferred: string | undefined,
  chain: ChainKey | undefined,
  input: string | readonly string[] | undefined,
): ChainKey | undefined {
  return chain ?? inferChain(input) ?? (preferred === undefined ? normalizeChain() : undefined);
}

/**
 * Run one read with provider selection and one automatic retry on another provider after a rate
 * or plan limit, no response at all, or a 5xx. When the retry fails too, its error carries the
 * first provider's failure as `cause`.
 *
 * An explicit chain wins. Without one, an address whose format fits one chain selects that chain,
 * even over an explicit provider's default. Only when the address fits no single chain does
 * selection start on Ethereum, or on the explicit provider's default chain. The callback must be safe to run twice.
 *
 * @param {string | undefined} preferred - The `preferred` value.
 * @param {ChainKey | undefined} chain - The `chain` value.
 * @param {(context: Readonly<ProviderContext>) => Promise<T>} run - The `run` value.
 * @param {ProviderCapability} capability - Operation required from an automatic selection.
 * @param {string | readonly string[]} input - Address or addresses the read is about.
 * @returns {Promise<T>} The resulting value.
 */
export async function withProvider<T>(
  preferred: string | undefined,
  chain: ChainKey | undefined,
  /* oxlint-disable-next-line typescript/prefer-readonly-parameter-types */
  run: (context: ProviderContext) => Promise<T>,
  capability?: ProviderCapability,
  input?: string | readonly string[],
): Promise<T> {
  const requestedChain = startingChain(preferred, chain, input);
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
    if (preferred !== undefined || fallbackName === undefined || !isTransientFailure(error)) {
      throw error;
    }

    return runFallback(execute, fallbackName, error);
  }
}
