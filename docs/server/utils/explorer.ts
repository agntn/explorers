import type { H3Event } from "h3";
import {
  UnsupportedOperationError,
  has,
  normalizeChain,
  providers,
  withProvider,
  type ChainKey,
  type Provider,
  type ProviderCapability,
  type ProviderContext,
} from "@agntn/explorers";
import type { ProviderStatus } from "#shared/wire";
import { providerInfo } from "../../app/utils/providers";

type Query = Record<string, unknown>;

/** The chain as `normalizeChain()` spells it; an alias like `btc` or `mainnet` is fine, a typo is a 400. */
export function readChain(query: Query): ChainKey | undefined {
  const value = readString(query, "chain", 32);
  if (value === undefined) {
    return undefined;
  }
  try {
    return normalizeChain(value);
  } catch {
    throw createError({ statusCode: 400, statusMessage: `Unknown chain: ${value}` });
  }
}

/** The chain, or the library's own default when the query names none. */
export function readChainOrDefault(query: Query): ChainKey {
  return readChain(query) ?? normalizeChain();
}

/** An explicit provider key, or nothing to let `resolveProvider()` choose. Anything unregistered is a 400. */
export function readProvider(query: Query): string | undefined {
  const value = readString(query, "provider", 32);
  if (value === undefined || value === "auto") {
    return undefined;
  }
  if (!has(value)) {
    throw createError({ statusCode: 400, statusMessage: `Unknown provider: ${value}` });
  }
  return value;
}

/** `configured` means a read can start here: keyless, key present, or a key the provider treats as optional (Blockchair). */
function providerStatus(key: string): ProviderStatus {
  const info = providerInfo(key);
  const envVars = info?.envVars ?? [];
  const keyless = envVars.length === 0;
  const configured =
    keyless || info?.optionalKey === true || envVars.every((name) => Boolean(process.env[name]));
  return { provider: key, configured, keyless };
}

let statuses: ProviderStatus[] | undefined;

/** Whether the worker holds each provider's key; env vars do not change inside an isolate, so once is enough. Never the key itself. */
export function providerStatuses(): ProviderStatus[] {
  statuses ??= providers().map(providerStatus);
  return statuses;
}

/**
 * Providers whose `getTxHistory` reads `TxHistoryOptions.page` (`options.page` in `src/providers/`); the
 * others walk a cursor the library keeps to itself, so a second page from them repeats the first.
 */
const PAGED_HISTORY = new Set(["etherscan", "koios", "arweave", "dcrdata"]);

/** Same for `getTokenTransfers`: Blockscout ignores `page` there too. */
const PAGED_TRANSFERS = new Set(["etherscan"]);

export function pagesHistory(provider: string): boolean {
  return PAGED_HISTORY.has(provider);
}

export function pagesTransfers(provider: string): boolean {
  return PAGED_TRANSFERS.has(provider);
}

type OptionalOperation = {
  [K in keyof Provider]-?: Provider[K] extends ((...args: never[]) => unknown) | undefined
    ? K
    : never;
}[keyof Provider];

/** The bound optional method, or the same `UnsupportedOperationError` the library throws for a flag that is false. */
export function requireOperation<K extends OptionalOperation>(
  selected: ProviderContext,
  capability: ProviderCapability,
  operation: K,
): NonNullable<Provider[K]> {
  const method = selected.provider[operation];
  if (!selected.provider.capabilities[capability] || typeof method !== "function") {
    throw new UnsupportedOperationError(operation, selected.name);
  }
  return method.bind(selected.provider) as NonNullable<Provider[K]>;
}

interface ReadOptions<T> {
  prefix: string;
  ttl: number;
  capability: ProviderCapability;
  chain: ChainKey | undefined;
  preferred: string | undefined;
  params: Readonly<Record<string, unknown>>;
  run: (selected: ProviderContext) => Promise<T>;
}

/**
 * One cached read through `withProvider()`: the same selection, keys and single retry as the CLI
 * and the tools, the answer stamped with the provider that spoke and when, library errors mapped
 * to statuses. Every route is this plus its own query parsing.
 */
export async function cachedRead<T extends object>(
  event: H3Event,
  options: ReadOptions<T>,
): Promise<T & { provider: string; chain: string; fetchedAt: string }> {
  const { prefix, ttl, capability, chain, preferred, params, run } = options;
  try {
    return await cachedAnswer(event, prefix, { ...params, chain, preferred }, ttl, () =>
      withProvider(
        preferred,
        chain,
        async (selected) => ({
          provider: selected.name,
          chain: selected.chain,
          ...(await run(selected)),
          fetchedAt: new Date().toISOString(),
        }),
        capability,
      ),
    );
  } catch (error) {
    return toHttpError(error);
  }
}
