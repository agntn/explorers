import type {
  Balance,
  BlockInfo,
  ChainKey,
  ContractInfo,
  GasData,
  ProviderCapabilities,
  TokenBalance,
  TokenBalanceOptions,
  TokenTransfer,
  TokenTransferOptions,
  Transaction,
  TxHistoryOptions,
  Utxo,
} from "./types.ts";
import { getJSON, postJSON } from "./client.ts";
import type { ClientRequestOptions } from "./client.ts";
import type { ProviderConfig } from "./types.ts";
import { RateLimitError } from "./errors.ts";

const RATE_LIMIT_RETRIES = 2;
const RATE_LIMIT_BASE_DELAY_MS = 1000;
const RATE_LIMIT_MAX_DELAY_MS = 30_000;

function rateLimitMessage(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value !== null && typeof value === "object" && "message" in value) {
    const message = value.message;
    if (typeof message === "string") return message;
  }
  return undefined;
}

function throwIfRateLimited(data: unknown, provider: string): void {
  if (data === null || typeof data !== "object") return;
  const record = data as Record<string, unknown>;
  for (const field of ["message", "result", "error"] as const) {
    const message = rateLimitMessage(record[field]);
    if (message !== undefined && /rate limit/i.test(message)) {
      throw new RateLimitError(provider);
    }
  }
}

function rateLimitDelayMs(retryAfter: number | undefined, attempt: number): number {
  const fromHeader = retryAfter === undefined ? undefined : retryAfter * 1000;
  const delay = fromHeader ?? RATE_LIMIT_BASE_DELAY_MS * 2 ** attempt;
  return Math.min(delay, RATE_LIMIT_MAX_DELAY_MS);
}

function abortReason(signal?: AbortSignal): Error {
  if (signal?.reason instanceof Error) return signal.reason;
  return new DOMException("This operation was aborted", "AbortError");
}

async function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw abortReason(signal);
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function withRateLimitRetry<T>(
  operation: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof RateLimitError) || attempt >= RATE_LIMIT_RETRIES) throw error;
      await abortableDelay(rateLimitDelayMs(error.retryAfter, attempt), signal);
    }
  }
}

/**
 * Common API for block explorer backends.
 *
 * A provider holds backend configuration, not an address. Pass addresses to the relevant methods
 * and check `capabilities` before using optional operations.
 */
// oxlint-disable-next-line typescript/no-unsafe-declaration-merging -- Optional methods stay absent at runtime.
export abstract class Provider {
  private readonly timeout: number | undefined;

  constructor(config: Readonly<ProviderConfig> = {}) {
    this.timeout = config.timeout;
  }

  /**
   * Registry key owned by the concrete class.
   *
   * @returns {string} The resulting value.
   */
  get name(): string {
    return (this.constructor as ProviderConstructor).key;
  }

  /** Operations this provider can actually serve. */
  abstract get capabilities(): ProviderCapabilities;

  /** Fetch the native-token balance for an address. */
  abstract getBalance(address: string, chain?: ChainKey): Promise<Balance>;

  /** List transactions involving an address. */
  abstract getTxHistory(
    address: string,
    chain?: ChainKey,
    options?: Readonly<TxHistoryOptions>,
  ): Promise<Transaction[]>;

  /**
   * Execute a provider-attributed GET request using the configured or per-request timeout.
   *
   * Retries HTTP 429 and JSON bodies that mention a rate limit, with backoff, before the error
   * leaves. The HTTP client itself does not retry.
   *
   * @param {string} url - Request URL.
   * @param {Omit<ClientRequestOptions, "provider">} options - Per-request headers, cancellation, and timeout override.
   * @returns {Promise<T>} Parsed JSON body.
   */
  protected getJSON<T>(url: string, options?: Omit<ClientRequestOptions, "provider">): Promise<T> {
    return withRateLimitRetry(async () => {
      const data = await getJSON<T>(url, {
        ...options,
        timeout: options?.timeout ?? this.timeout,
        provider: this.name,
      });
      throwIfRateLimited(data, this.name);
      return data;
    }, options?.signal);
  }

  /**
   * Execute a provider-attributed JSON POST request using the configured timeout.
   *
   * Retries HTTP 429 and JSON bodies that mention a rate limit, with backoff, before the error
   * leaves. Explorer POSTs are reads, so retrying them is safe.
   *
   * @param {string} url - Request URL.
   * @param {unknown} body - JSON request body.
   * @param {Omit<ClientRequestOptions, "provider">} options - Per-request headers, cancellation, and timeout override.
   * @returns {Promise<T>} Parsed JSON body.
   */
  protected postJSON<T>(
    url: string,
    body: unknown,
    options?: Omit<ClientRequestOptions, "provider">,
  ): Promise<T> {
    return withRateLimitRetry(async () => {
      const data = await postJSON<T>(url, body, {
        ...options,
        timeout: options?.timeout ?? this.timeout,
        provider: this.name,
      });
      throwIfRateLimited(data, this.name);
      return data;
    }, options?.signal);
  }

  /**
   * Date a completed balance read and preserve any chain position the response exposes.
   *
   * @param {Omit<Balance, "fetchedAt" | "blockNumber" | "blockHash">} balance - The `balance` value.
   * @param {Readonly<{ blockNumber?: number | null; blockHash?: string | null }>} position - The `position` value.
   * @returns {Balance} The resulting value.
   */
  protected snapshotBalance(
    balance: Omit<Balance, "fetchedAt" | "blockNumber" | "blockHash">,
    position: Readonly<{ blockNumber?: number | null; blockHash?: string | null }> = {},
  ): Balance {
    return {
      ...balance,
      fetchedAt: new Date().toISOString(),
      blockNumber: position.blockNumber ?? null,
      blockHash: position.blockHash ?? null,
    };
  }
}

/** Concrete provider class accepted by the registry. */
export interface ProviderConstructor {
  /** Stable registry key owned by the concrete class. */
  readonly key: string;
  new (config: Readonly<ProviderConfig>): Provider;
}

/** One operation that provider selection can require. */
export type ProviderCapability = keyof ProviderCapabilities;

/** What the registry answers about a provider without loading its module. */
export interface ProviderMeta {
  /** Chains the provider can serve, consulted during auto-selection. */
  chains: readonly ChainKey[];
  /** Operations the provider can serve. Omit to keep external registrations backward-compatible. */
  capabilities?: readonly ProviderCapability[];
  /** Public endpoint advertised for the provider. */
  defaultURL?: string;
}

/**
 * One provider in the built-in list.
 *
 * The metadata is repeated here instead of read off the class so that listing providers, matching a
 * chain or reporting an endpoint never loads provider code. `load` pulls the class in when someone
 * actually asks for an instance.
 */
export interface ProviderEntry extends ProviderMeta {
  key: string;
  load: () => Promise<ProviderConstructor>;
}

/**
 * Operations exposed only by providers that support them.
 *
 * Unsupported methods stay absent at runtime. Check `capabilities` before calling.
 */
export interface Provider {
  /** Fetch one transaction by its hash. */
  getTxDetail?(hash: string, chain?: ChainKey): Promise<Transaction>;

  /** List the unspent outputs an address still controls, on chains that track them. */
  getUtxos?(address: string, chain?: ChainKey): Promise<Utxo[]>;

  /** Fetch available metadata, ABI, and source for a contract address. */
  getContractInfo?(address: string, chain?: ChainKey): Promise<ContractInfo>;

  /** List token holdings for an address. */
  getTokenBalances?(
    address: string,
    chain?: ChainKey,
    options?: Readonly<TokenBalanceOptions>,
  ): Promise<TokenBalance[]>;

  /** List fungible-token transfers involving an address. */
  getTokenTransfers?(
    address: string,
    chain?: ChainKey,
    options?: Readonly<TokenTransferOptions>,
  ): Promise<TokenTransfer[]>;

  /** Fetch the provider's current gas-price suggestions. */
  getGasData?(chain?: ChainKey): Promise<GasData>;

  /** Fetch a block by number. */
  getBlockInfo?(blockNumber: number, chain?: ChainKey): Promise<BlockInfo>;
}
