/**
 * Solscan provider — indexed Solana explorer API.
 *
 * https://pro-api.solscan.io/pro-api-docs/v2.0
 */

import type {
  Balance,
  BlockInfo,
  ChainKey,
  ProviderCapabilities,
  ProviderConfig,
  Transaction,
  TxHistoryOptions,
  TxStatus,
} from "../core/types.js";
import { Provider } from "../core/provider.js";
import { normalizeBaseUrl, buildQuery } from "../core/client.js";
import { AuthError, ExplorerError, UnsupportedChainError } from "../core/errors.js";
import { register } from "../core/registry.js";
import { assertSafePathSegment } from "../core/path-safety.js";
import { clampMaxResults, formatWei } from "../core/types.js";

const DEFAULT_BASE = "https://pro-api.solscan.io/v2.0";

interface SolscanResponse<T> {
  success: boolean;
  data: T;
  errors?: string | { message?: string };
}

interface SolscanAccount {
  account: string;
  lamports: string | number;
}

interface SolscanAccountTransaction {
  slot: number;
  fee: string | number;
  status: string;
  signer: string;
  block_time: number;
  tx_hash: string;
  program_ids?: string[];
}

interface SolscanTransactionDetail {
  tx_hash: string;
  block_id: number;
  block_time: number;
  fee: string | number;
  signer: string | string[];
  status: number;
  compute_units_consumed?: string | number;
  programs_involved?: string[];
}

interface SolscanBlock {
  fee_rewards: string | number;
  transactions_count: number;
  current_slot: number;
  block_height: number;
  block_time: number;
  blockhash: string;
  parent_slot: number;
}

function toTimestamp(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

function mapAccountTransaction(raw: SolscanAccountTransaction): Transaction {
  return {
    hash: raw.tx_hash,
    blockNumber: raw.slot,
    timestamp: toTimestamp(raw.block_time),
    from: raw.signer,
    to: null,
    value: "0",
    valueFormatted: "0",
    fee: String(raw.fee),
    status: (raw.status.toLowerCase() === "success" ? "success" : "failed") as TxStatus,
    isContractInteraction: (raw.program_ids?.length ?? 0) > 0,
    tokenTransfers: [],
    raw: raw as unknown as Record<string, unknown>,
  };
}

function mapTransactionDetail(raw: SolscanTransactionDetail): Transaction {
  const signer = Array.isArray(raw.signer) ? (raw.signer[0] ?? "") : raw.signer;
  return {
    hash: raw.tx_hash,
    blockNumber: raw.block_id,
    timestamp: toTimestamp(raw.block_time),
    from: signer,
    to: null,
    value: "0",
    valueFormatted: "0",
    gasUsed:
      raw.compute_units_consumed === undefined ? undefined : String(raw.compute_units_consumed),
    fee: String(raw.fee),
    status: (raw.status === 1 ? "success" : "failed") as TxStatus,
    isContractInteraction: (raw.programs_involved?.length ?? 0) > 0,
    tokenTransfers: [],
    raw: raw as unknown as Record<string, unknown>,
  };
}

class Solscan extends Provider {
  static readonly key = "solscan";

  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: ProviderConfig) {
    super(config);
    const apiKey = config.apiKey ?? process.env.SOLSCAN_API_KEY ?? "";
    if (!apiKey) {
      throw new AuthError("solscan", "Set SOLSCAN_API_KEY or pass apiKey in config");
    }
    this.apiKey = apiKey;
    this.baseUrl = normalizeBaseUrl(config.baseUrl ?? DEFAULT_BASE);
  }
  get capabilities(): ProviderCapabilities {
    return {
      balances: true,
      txHistory: true,
      txDetail: true,
      contractInfo: false,
      tokenBalances: false,
      tokenTransfers: false,
      gasData: false,
      blockInfo: true,
    };
  }

  private async api<T>(
    path: string,
    params: Record<string, string | number | undefined>,
  ): Promise<T> {
    const response = await this.getJSON<SolscanResponse<T>>(
      `${this.baseUrl}${path}${buildQuery(params)}`,
      { headers: { token: this.apiKey } },
    );
    if (!response.success) {
      const detail =
        typeof response.errors === "string" ? response.errors : response.errors?.message;
      throw new ExplorerError(`Solscan API error${detail ? `: ${detail}` : ""}`, this.name);
    }
    return response.data;
  }

  async getBalance(address: string, chain?: ChainKey): Promise<Balance> {
    const c = chain ?? "solana";
    if (c !== "solana") throw new UnsupportedChainError(c, this.name);
    assertSafePathSegment(address, "address");

    const data = await this.api<SolscanAccount>("/account/detail", { address });
    const balance = String(data.lamports);
    return {
      address,
      chain: "solana",
      balance,
      balanceFormatted: formatWei(balance, 9),
      symbol: "SOL",
    };
  }

  async getTxHistory(
    address: string,
    chain?: ChainKey,
    options?: TxHistoryOptions,
  ): Promise<Transaction[]> {
    const c = chain ?? "solana";
    if (c !== "solana") throw new UnsupportedChainError(c, this.name);
    assertSafePathSegment(address, "address");

    const transactions = await this.api<SolscanAccountTransaction[]>("/account/transactions", {
      address,
      limit: clampMaxResults(options?.limit, 40),
    });
    return transactions.map(mapAccountTransaction);
  }

  override async getTxDetail(hash: string, chain?: ChainKey): Promise<Transaction> {
    const c = chain ?? "solana";
    if (c !== "solana") throw new UnsupportedChainError(c, this.name);
    assertSafePathSegment(hash, "tx hash");

    const transaction = await this.api<SolscanTransactionDetail>("/transaction/detail", {
      tx: hash,
    });
    return mapTransactionDetail(transaction);
  }

  override async getBlockInfo(blockNumber: number, chain?: ChainKey): Promise<BlockInfo> {
    const c = chain ?? "solana";
    if (c !== "solana") throw new UnsupportedChainError(c, this.name);
    assertSafePathSegment(String(blockNumber), "block number");

    const block = await this.api<SolscanBlock>("/block/detail", { block: blockNumber });
    return {
      number: block.current_slot,
      hash: block.blockhash,
      parentHash: String(block.parent_slot),
      timestamp: toTimestamp(block.block_time),
      miner: "",
      gasUsed: String(block.fee_rewards),
      gasLimit: "0",
      txCount: block.transactions_count,
    };
  }
}

register(Solscan, DEFAULT_BASE);
