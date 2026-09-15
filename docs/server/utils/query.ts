import type { H3Event } from "h3";
import { hash } from "ohash";
import {
  AuthError,
  ExplorerError,
  HTTPError,
  NotFoundError,
  PlanRestrictedError,
  RateLimitError,
  UnknownProviderError,
  UnsupportedChainError,
  UnsupportedOperationError,
} from "@agntn/explorers";
import { IDENTIFIER_MAX, isIdentifier } from "#shared/identifier";

type Query = Record<string, unknown>;

/** Caps every public parameter well below anything an explorer would mind. */
export const LIMITS = {
  address: IDENTIFIER_MAX,
  /** Transactions or transfers per page. */
  limit: 25,
  /** Highest page the worker asks for. */
  page: 100,
  /** Token holdings returned from one read. */
  tokens: 50,
  /** Unspent outputs returned from one read. */
  utxos: 50,
  /** Highest block number the page accepts; well past every chain's height. */
  block: 2_000_000_000,
} as const;

/** Seconds an answer stays cached, per operation. */
export const TTL = {
  balance: 2 * 60,
  history: 5 * 60,
  detail: 60 * 60,
  contract: 24 * 60 * 60,
  tokens: 10 * 60,
  utxos: 2 * 60,
  transfers: 5 * 60,
  gas: 30,
  block: 60 * 60,
  providers: 5 * 60,
  /** The chain tip: fresh enough for a feed, long enough for KV, whose reads settle over about a minute. */
  tip: 30,
  blockTxs: 60 * 60,
} as const;

function raw(query: Query, key: string): string | undefined {
  const value = query[key];
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : undefined;
  }
  return typeof value === "string" ? value : undefined;
}

export function readString(query: Query, key: string, max: number): string | undefined {
  const value = raw(query, key)?.trim();
  if (!value) {
    return undefined;
  }
  if (value.length > max) {
    throw createError({
      statusCode: 400,
      statusMessage: `${key} must be at most ${max} characters`,
    });
  }
  return value;
}

export function requireString(query: Query, key: string, max: number): string {
  const value = readString(query, key, max);
  if (!value) {
    throw createError({ statusCode: 400, statusMessage: `${key} is required` });
  }
  return value;
}

export function readInt(query: Query, key: string, min: number, max: number): number | undefined {
  const value = raw(query, key);
  if (value === undefined || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw createError({
      statusCode: 400,
      statusMessage: `${key} must be an integer between ${min} and ${max}`,
    });
  }
  return parsed;
}

/** An address, an ENS name or a hash, by the same predicate the page applies before it asks. */
export function readIdentifier(query: Query, key: string): string {
  const value = requireString(query, key, LIMITS.address);
  if (!isIdentifier(value)) {
    throw createError({
      statusCode: 400,
      statusMessage: `${key} must be an address, an ENS name or a transaction hash`,
    });
  }
  return value;
}

/** Stable cache key from the parameters that reach the library, so two spellings of one request share an entry. */
export function cacheKey(prefix: string, params: Readonly<Record<string, unknown>>): string {
  const entries = Object.entries(params)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `${prefix}:${JSON.stringify(entries)}`;
}

/** The part of a message before the first `:` or `[`, so an endpoint or a response body never reaches the page. */
export function failureText(message: string): string {
  const head = message.split(/[:[{]/u, 2)[0]?.trim() || message;
  const points = [...head];
  return points.length > 160 ? `${points.slice(0, 159).join("").trimEnd()}…` : head;
}

/** Turns a library error into the status the browser can show; the typed hierarchy decides the code. */
export function toHttpError(error: unknown): never {
  if (
    error &&
    typeof error === "object" &&
    "statusCode" in error &&
    !(error instanceof ExplorerError)
  ) {
    throw error;
  }
  if (error instanceof NotFoundError) {
    throw createError({
      statusCode: 404,
      statusMessage: `${error.provider ?? "The explorer"} found nothing under that address, hash or number`,
    });
  }
  if (error instanceof UnknownProviderError) {
    throw createError({ statusCode: 400, statusMessage: "No provider with that name" });
  }
  if (error instanceof UnsupportedChainError || error instanceof UnsupportedOperationError) {
    throw createError({ statusCode: 422, statusMessage: failureText(error.message) });
  }
  if (error instanceof AuthError) {
    throw createError({
      statusCode: 503,
      statusMessage: `${error.provider} wants an API key for this read and the docs worker has none`,
    });
  }
  if (error instanceof PlanRestrictedError) {
    throw createError({
      statusCode: 503,
      statusMessage: `${error.provider} keeps this read behind a paid plan the docs worker does not have`,
    });
  }
  if (error instanceof RateLimitError) {
    const retry = error.retryAfter ? ` Retry after ${error.retryAfter}s.` : "";
    throw createError({
      statusCode: 429,
      statusMessage: `${error.provider} is rate limiting the docs worker.${retry}`,
    });
  }
  if (error instanceof HTTPError) {
    throw createError({
      statusCode: 502,
      statusMessage: `${error.provider ?? "The explorer"} answered HTTP ${error.statusCode}`,
    });
  }
  if (error instanceof ExplorerError) {
    throw createError({
      statusCode: 502,
      statusMessage: `${error.provider ?? "The explorer"} failed: ${failureText(error.message)}`,
    });
  }
  if (error instanceof RangeError) {
    throw createError({ statusCode: 400, statusMessage: failureText(error.message) });
  }
  const message = error instanceof Error ? error.message : String(error);
  throw createError({ statusCode: 502, statusMessage: failureText(message) });
}

export function markPublic(event: H3Event, seconds: number): void {
  setResponseHeader(
    event,
    "Cache-Control",
    `public, max-age=${seconds}, stale-while-revalidate=${seconds * 4}`,
  );
}

/** Uncached explorer requests one client may start per minute; cache hits are free. */
export const RATE_LIMIT = 30;

/** Counts uncached requests per client and minute; cache hits are free, so a warm demo never trips it. */
export async function assertRateLimit(event: H3Event): Promise<void> {
  /** Cloudflare's own header first; X-Forwarded-For is whatever the client typed. */
  const ip =
    getRequestHeader(event, "cf-connecting-ip") ??
    getRequestIP(event, { xForwardedFor: true }) ??
    "unknown";
  const minute = Math.floor(Date.now() / 60_000);
  const key = `docs:rate:${hash(ip)}:${minute}`;
  const storage = useStorage("cache");
  const count = Number((await storage.getItem<number>(key).catch(() => 0)) ?? 0) + 1;
  await storage.setItem(key, count, { ttl: 120 }).catch(() => undefined);
  if (count > RATE_LIMIT) {
    setResponseHeader(event, "Retry-After", 60 - (Math.floor(Date.now() / 1000) % 60));
    throw createError({
      statusCode: 429,
      statusMessage: `More than ${RATE_LIMIT} new explorer requests in a minute from one address; cached answers are not counted. Wait a moment.`,
    });
  }
}

interface CachedEntry<T> {
  value: T;
  expires: number;
}

/** Productions in flight in this isolate, so a burst of misses on one key asks the explorer once. */
const inFlight = new Map<string, Promise<unknown>>();

/** Serves from the cache or produces and stores; a thrown failure is never stored. */
export async function cachedAnswer<T>(
  event: H3Event,
  prefix: string,
  params: Readonly<Record<string, unknown>>,
  ttl: number,
  produce: () => Promise<T>,
): Promise<T> {
  const storage = useStorage("cache");
  const key = `docs:${prefix}:${hash(cacheKey(prefix, params))}`;
  const hit = await storage.getItem<CachedEntry<T>>(key).catch(() => null);
  if (hit && typeof hit.expires === "number" && hit.expires > Date.now()) {
    markPublic(event, Math.max(1, Math.floor((hit.expires - Date.now()) / 1000)));
    return hit.value;
  }
  await assertRateLimit(event);
  let pending = inFlight.get(key) as Promise<T> | undefined;
  if (!pending) {
    pending = produce().finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  const value = await pending;
  /** KV expires the entry itself a while after the logical TTL; its floor is sixty seconds. */
  await storage
    .setItem(key, { value, expires: Date.now() + ttl * 1000 }, { ttl: Math.max(60, ttl * 4) })
    .catch(() => undefined);
  markPublic(event, ttl);
  return value;
}
