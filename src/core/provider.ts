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
} from "./types.js";
import { getJSON, postJSON } from "./client.js";
import type { ClientRequestOptions } from "./client.js";
import type { ProviderConfig } from "./types.js";

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
   * Execute a provider-attributed GET request using the configured timeout.
   *
   * @param {string} url - The `url` value.
   * @param {Omit<ClientRequestOptions, "provider" | "timeout">} options - Per-request headers and cancellation.
   * @returns {Promise<T>} The resulting value.
   */
  protected getJSON<T>(
    url: string,
    options?: Omit<ClientRequestOptions, "provider" | "timeout">,
  ): Promise<T> {
    return getJSON<T>(url, { ...options, timeout: this.timeout, provider: this.name });
  }

  /**
   * Execute a provider-attributed JSON POST request using the configured timeout.
   *
   * @param {string} url - The `url` value.
   * @param {unknown} body - The `body` value.
   * @returns {Promise<T>} The resulting value.
   */
  protected postJSON<T>(url: string, body: unknown): Promise<T> {
    return postJSON<T>(url, body, { timeout: this.timeout, provider: this.name });
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
