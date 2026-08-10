import type {
  Balance,
  BlockInfo,
  Chain,
  ContractInfo,
  GasData,
  ProviderCapabilities,
  TokenBalance,
  TokenBalanceOptions,
  Transaction,
  TxHistoryOptions,
} from "./types.js";
import { getJSON, postJSON } from "./client.js";
import type { ClientOptions } from "./client.js";
import type { ProviderConfig } from "./types.js";

/**
 * Common API for block explorer backends.
 *
 * A provider holds backend configuration, not an address. Pass addresses to the
 * relevant methods and check `capabilities` before using optional operations.
 */
// oxlint-disable-next-line typescript/no-unsafe-declaration-merging -- Optional methods stay absent at runtime.
export abstract class Provider {
  private readonly timeout: number | undefined;

  constructor(config: ProviderConfig = {}) {
    this.timeout = config.timeout;
  }

  /** Registry key owned by the concrete class. */
  get name(): string {
    return (this.constructor as ProviderConstructor).key;
  }

  /** Operations this provider can actually serve. */
  abstract get capabilities(): ProviderCapabilities;

  /** Fetch the native-token balance for an address. */
  abstract getBalance(address: string, chain?: Chain): Promise<Balance>;

  /** List transactions involving an address. */
  abstract getTxHistory(
    address: string,
    chain?: Chain,
    options?: TxHistoryOptions,
  ): Promise<Transaction[]>;

  /** Execute a provider-attributed GET request using the configured timeout. */
  protected getJSON<T>(
    url: string,
    options?: Omit<ClientOptions, "provider" | "timeout">,
  ): Promise<T> {
    return getJSON<T>(url, { ...options, timeout: this.timeout, provider: this.name });
  }

  /** Execute a provider-attributed JSON POST request using the configured timeout. */
  protected postJSON<T>(url: string, body: unknown): Promise<T> {
    return postJSON<T>(url, body, { timeout: this.timeout, provider: this.name });
  }
}

/** Concrete provider class accepted by the registry. */
export interface ProviderConstructor {
  /** Stable registry key owned by the concrete class. */
  readonly key: string;
  new (config: ProviderConfig): Provider;
}

/**
 * Operations exposed only by providers that support them.
 *
 * Unsupported methods stay absent at runtime. Check `capabilities` before calling.
 */
export interface Provider {
  /** Fetch one transaction by its hash. */
  getTxDetail?(hash: string, chain?: Chain): Promise<Transaction>;

  /** Fetch available metadata, ABI, and source for a contract address. */
  getContractInfo?(address: string, chain?: Chain): Promise<ContractInfo>;

  /** List token holdings for an address. */
  getTokenBalances?(
    address: string,
    chain?: Chain,
    options?: TokenBalanceOptions,
  ): Promise<TokenBalance[]>;

  /** Fetch the provider's current gas-price suggestions. */
  getGasData?(chain?: Chain): Promise<GasData>;

  /** Fetch a block by number. */
  getBlockInfo?(blockNumber: number, chain?: Chain): Promise<BlockInfo>;
}
