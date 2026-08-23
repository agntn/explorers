/**
 * Helius provider - enhanced Solana transaction indexer behind the XRAY explorer.
 *
 * https://www.helius.dev/docs/api-reference/enhanced-transactions
 */

import type {
  Balance,
  ChainKey,
  ProviderCapabilities,
  ProviderConfig,
  Transaction,
  TxHistoryOptions,
  TxStatus,
} from "../core/types.js";
import { Provider } from "../core/provider.js";
import { normalizeBaseUrl, buildQuery } from "../core/client.js";
import {
  AuthError,
  NotFoundError,
  UnsupportedChainError,
  UnsupportedOperationError,
} from "../core/errors.js";
import { register } from "../core/registry.js";
import { assertSafePathSegment } from "../core/path-safety.js";
import { clampMaxResults } from "../core/types.js";

const DEFAULT_BASE = "https://mainnet.helius-rpc.com";

/** Programs present in plain transfers that do not make a transaction a contract interaction. */
const SYSTEM_PROGRAMS = new Set([
  "11111111111111111111111111111111",
  "ComputeBudget111111111111111111111111111111",
]);

interface HeliusNativeTransfer {
  fromUserAccount: string | null;
  toUserAccount: string | null;
  amount: string | number;
}

interface HeliusInstruction {
  programId: string;
}

interface HeliusTransaction {
  signature: string;
  slot: number;
  timestamp: number;
  fee: string | number;
  feePayer: string;
  type?: string;
  source?: string;
  description?: string;
  transactionError?: unknown;
  nativeTransfers?: HeliusNativeTransfer[];
  instructions?: HeliusInstruction[];
}

function toTimestamp(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

function mapTransaction(raw: HeliusTransaction): Transaction {
  const programs = raw.instructions ?? [];
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
    isContractInteraction: programs.some((i) => !SYSTEM_PROGRAMS.has(i.programId)),
    tokenTransfers: [],
    raw: raw as unknown as Record<string, unknown>,
  };
}

class Helius extends Provider {
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
      tokenBalances: false,
      tokenTransfers: false,
      gasData: false,
      blockInfo: false,
    };
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

    const transactions = await this.getJSON<HeliusTransaction[]>(
      `${this.baseUrl}/v0/addresses/${address}/transactions${buildQuery({
        "api-key": this.apiKey,
        limit: clampMaxResults(options?.limit, 100),
      })}`,
    );
    return transactions.map(mapTransaction);
  }

  override async getTxDetail(hash: string, chain?: ChainKey): Promise<Transaction> {
    const c = chain ?? "solana";
    if (c !== "solana") throw new UnsupportedChainError(c, this.name);

    const transactions = await this.postJSON<HeliusTransaction[]>(
      `${this.baseUrl}/v0/transactions${buildQuery({ "api-key": this.apiKey })}`,
      { transactions: [hash] },
    );
    const transaction = transactions[0];
    if (!transaction) throw new NotFoundError(hash, this.name);
    return mapTransaction(transaction);
  }
}

register(Helius, DEFAULT_BASE);
