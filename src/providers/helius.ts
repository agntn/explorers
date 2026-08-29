/**
 * Helius provider - enhanced Solana transaction indexer API.
 *
 * https://www.helius.dev/docs/api-reference/enhanced-transactions
 */

import type {
  Balance,
  ChainKey,
  ProviderCapabilities,
  ProviderConfig,
  TokenBalance,
  TokenBalanceOptions,
  Transaction,
  TxHistoryOptions,
  TxStatus,
} from "../core/types.js";
import { Provider } from "../core/provider.js";
import { normalizeBaseUrl, buildQuery } from "../core/client.js";
import {
  AuthError,
  ExplorerError,
  NotFoundError,
  UnsupportedChainError,
  UnsupportedOperationError,
} from "../core/errors.js";
import { assertSafePathSegment } from "../core/path-safety.js";
import { clampMaxResults, formatWei, toTimestamp } from "../core/types.js";

const DEFAULT_BASE = "https://mainnet.helius-rpc.com";

/** Largest page the DAS search endpoint accepts; it answers 1001 with a validation error. */
const DAS_PAGE_LIMIT = 1000;

/** Pages the holdings walk visits, so one owner cannot fan out an unbounded number of requests. */
const DAS_MAX_PAGES = 20;

/** Programs present in plain transfers that do not make a transaction a contract interaction. */
const SYSTEM_PROGRAMS = new Set([
  "11111111111111111111111111111111",
  "ComputeBudget111111111111111111111111111111",
]);

interface HeliusTransaction {
  readonly signature: string;
  readonly slot: number;
  readonly timestamp: number;
  readonly fee: string | number;
  readonly feePayer: string;
  readonly transactionError?: unknown;
  readonly instructions?: readonly { readonly programId: string }[];
}

/** JSON-RPC envelope shared by the DAS methods; failures arrive inside a 200 response. */
interface HeliusRpcResponse<T> {
  readonly result?: T;
  readonly error?: { readonly code: number; readonly message: string };
}

interface HeliusAsset {
  readonly id: string;
  readonly content?: { readonly metadata?: { readonly name?: string; readonly symbol?: string } };
  readonly token_info?: {
    readonly balance?: string | number;
    readonly decimals?: number;
    readonly symbol?: string;
    readonly price_info?: { readonly price_per_token?: number; readonly total_price?: number };
  };
}

const isNonSystemProgram = (instruction: Readonly<{ programId: string }>): boolean =>
  !SYSTEM_PROGRAMS.has(instruction.programId);

function tokenIdentity(asset: Readonly<HeliusAsset>): {
  readonly name?: string;
  readonly symbol: string;
} {
  const metadata = asset.content?.metadata;
  return {
    name: metadata?.name,
    symbol: metadata?.symbol ?? asset.token_info?.symbol ?? "",
  };
}

/* Read one holding off a DAS asset. Metaplex metadata names a token more often than its mint. */
function mapTokenBalance(asset: Readonly<HeliusAsset>): TokenBalance {
  const info = asset.token_info;
  const identity = tokenIdentity(asset);
  const decimals = info?.decimals ?? 0;
  const balance = String(info?.balance ?? "0");
  const price = info?.price_info;

  return {
    contract: asset.id,
    symbol: identity.symbol,
    name: identity.name,
    decimals,
    balance,
    balanceFormatted: formatWei(balance, decimals),
    priceUsd: price?.price_per_token,
    valueUsd: price?.total_price,
  };
}

function mapTransaction(raw: Readonly<HeliusTransaction>): Transaction {
  return {
    hash: raw.signature,
    blockNumber: raw.slot,
    timestamp: toTimestamp(raw.timestamp),
    from: raw.feePayer,
    to: null,
    value: "0",
    valueFormatted: "0",
    fee: String(raw.fee),
    status: (raw.transactionError === null || raw.transactionError === undefined
      ? "success"
      : "failed") as TxStatus,
    isContractInteraction: raw.instructions?.some(isNonSystemProgram) ?? false,
    tokenTransfers: [],
    raw: raw as unknown as Record<string, unknown>,
  };
}

export class Helius extends Provider {
  static readonly key = "helius";

  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: Readonly<ProviderConfig>) {
    super(config);
    const apiKey = config.apiKey ?? process.env.HELIUS_API_KEY ?? "";
    if (!apiKey) {
      throw new AuthError("helius", "Set HELIUS_API_KEY or pass apiKey in config");
    }
    this.apiKey = apiKey;
    this.baseUrl = normalizeBaseUrl(config.baseUrl ?? DEFAULT_BASE);
  }

  get capabilities(): ProviderCapabilities {
    return {
      balances: false,
      txHistory: true,
      txDetail: true,
      contractInfo: false,
      tokenBalances: true,
      tokenTransfers: false,
      gasData: false,
      blockInfo: false,
    };
  }

  private api<T>(
    path: string,
    params: Readonly<Record<string, string | number | undefined>> = {},
  ): Promise<T> {
    return this.getJSON<T>(
      `${this.baseUrl}${path}${buildQuery({ "api-key": this.apiKey, ...params })}`,
    );
  }

  private apiPost<T>(path: string, body: unknown): Promise<T> {
    return this.postJSON<T>(
      `${this.baseUrl}${path}${buildQuery({ "api-key": this.apiKey })}`,
      body,
    );
  }

  /* Call a DAS method on the RPC root and unwrap its JSON-RPC envelope. */
  private async rpc<T>(method: string, params: unknown): Promise<T> {
    const response = await this.apiPost<HeliusRpcResponse<T>>("/", {
      jsonrpc: "2.0",
      id: "explorers",
      method,
      params,
    });

    if (response.error) {
      throw new ExplorerError(`Helius API error: ${response.error.message}`, this.name);
    }
    if (response.result === null || response.result === undefined) {
      throw new ExplorerError(`Helius returned no result for ${method}`, this.name);
    }
    return response.result;
  }

  async getBalance(_address: string, chain?: ChainKey): Promise<Balance> {
    const c = chain ?? "solana";
    if (c !== "solana") throw new UnsupportedChainError(c, this.name);
    throw new UnsupportedOperationError("getBalance", this.name);
  }

  async getTxHistory(
    address: string,
    chain?: ChainKey,
    options?: Readonly<TxHistoryOptions>,
  ): Promise<Transaction[]> {
    const c = chain ?? "solana";
    if (c !== "solana") throw new UnsupportedChainError(c, this.name);
    assertSafePathSegment(address, "address");

    const transactions = await this.api<HeliusTransaction[]>(
      `/v0/addresses/${encodeURIComponent(address)}/transactions`,
      { limit: clampMaxResults(options?.limit, 100) },
    );
    return transactions.map(mapTransaction);
  }

  /**
   * List an owner's fungible holdings. Airdrop spam pushes ordinary wallets past one page.
   *
   * @param {string} address - The `address` value.
   * @param {ChainKey} chain - The `chain` value.
   * @param {Readonly<TokenBalanceOptions>} options - The `options` value.
   * @returns {Promise<TokenBalance[]>} The resulting value.
   */
  override async getTokenBalances(
    address: string,
    chain?: ChainKey,
    options?: Readonly<TokenBalanceOptions>,
  ): Promise<TokenBalance[]> {
    const c = chain ?? "solana";
    if (c !== "solana") throw new UnsupportedChainError(c, this.name);

    const tokens: TokenBalance[] = [];
    for (let page = 1; page <= DAS_MAX_PAGES; page++) {
      const result = await this.rpc<{ items?: HeliusAsset[] }>("searchAssets", {
        ownerAddress: address,
        tokenType: "fungible",
        limit: DAS_PAGE_LIMIT,
        page,
      });
      const items = result.items ?? [];
      tokens.push(...items.map(mapTokenBalance));
      if (items.length < DAS_PAGE_LIMIT) break;
    }

    return options?.nonZeroOnly ? tokens.filter((token) => token.balance !== "0") : tokens;
  }

  override async getTxDetail(hash: string, chain?: ChainKey): Promise<Transaction> {
    const c = chain ?? "solana";
    if (c !== "solana") throw new UnsupportedChainError(c, this.name);

    const transactions = await this.apiPost<HeliusTransaction[]>("/v0/transactions", {
      transactions: [hash],
    });
    const transaction = transactions[0];
    if (!transaction) throw new NotFoundError(hash, this.name);
    return mapTransaction(transaction);
  }
}
