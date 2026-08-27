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
  signature: string;
  slot: number;
  timestamp: number;
  fee: string | number;
  feePayer: string;
  transactionError?: unknown;
  instructions?: { programId: string }[];
}

/** JSON-RPC envelope shared by the DAS methods; failures arrive inside a 200 response. */
interface HeliusRpcResponse<T> {
  result?: T;
  error?: { code: number; message: string };
}

interface HeliusAsset {
  id: string;
  content?: { metadata?: { name?: string; symbol?: string } };
  token_info?: {
    balance?: string | number;
    decimals?: number;
    symbol?: string;
    price_info?: { price_per_token?: number; total_price?: number };
  };
}

const isNonSystemProgram = (instruction: { programId: string }): boolean =>
  !SYSTEM_PROGRAMS.has(instruction.programId);

/** Read one holding off a DAS asset. Metaplex metadata names a token more often than its mint. */
function mapTokenBalance(asset: HeliusAsset): TokenBalance {
  const info = asset.token_info;
  const decimals = info?.decimals ?? 0;
  const balance = String(info?.balance ?? "0");

  return {
    contract: asset.id,
    symbol: asset.content?.metadata?.symbol ?? info?.symbol ?? "",
    name: asset.content?.metadata?.name,
    decimals,
    balance,
    balanceFormatted: formatWei(balance, decimals),
    priceUsd: info?.price_info?.price_per_token,
    valueUsd: info?.price_info?.total_price,
  };
}

function mapTransaction(raw: HeliusTransaction): Transaction {
  return {
    hash: raw.signature,
    blockNumber: raw.slot,
    timestamp: toTimestamp(raw.timestamp),
    from: raw.feePayer,
    to: null,
    value: "0",
    valueFormatted: "0",
    fee: String(raw.fee),
    status: (raw.transactionError == null ? "success" : "failed") as TxStatus,
    isContractInteraction: raw.instructions?.some(isNonSystemProgram) ?? false,
    tokenTransfers: [],
    raw: raw as unknown as Record<string, unknown>,
  };
}

export class Helius extends Provider {
  static readonly key = "helius";

  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: ProviderConfig) {
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
    params: Record<string, string | number | undefined> = {},
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

  /** Call a DAS method on the RPC root and unwrap its JSON-RPC envelope. */
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
    if (response.result == null) {
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
    options?: TxHistoryOptions,
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

  /** List an owner's fungible holdings. Airdrop spam pushes ordinary wallets past one page. */
  override async getTokenBalances(
    address: string,
    chain?: ChainKey,
    options?: TokenBalanceOptions,
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
