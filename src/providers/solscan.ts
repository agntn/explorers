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
import { assertSafePathSegment } from "../core/path-safety.js";
import { clampMaxResults, formatWei, toTimestamp } from "../core/types.js";

const DEFAULT_BASE = "https://pro-api.solscan.io/v2.0";
const TRANSACTION_PAGE_SIZE = 40;

interface SolscanResponse<T> {
  readonly success: boolean;
  readonly data: T;
  readonly errors?: string | { readonly message?: string };
}

interface SolscanAccount {
  readonly account: string;
  readonly lamports: string | number;
}

interface SolscanAccountTransaction {
  readonly slot: number;
  readonly fee: string | number;
  readonly status: string;
  readonly signer: string;
  readonly block_time: number;
  readonly tx_hash: string;
  readonly program_ids?: readonly string[];
}

interface SolscanTransactionDetail {
  readonly tx_hash: string;
  readonly block_id: number;
  readonly block_time: number;
  readonly fee: string | number;
  readonly signer: string | readonly string[];
  readonly status: number;
  readonly compute_units_consumed?: string | number;
  readonly programs_involved?: readonly string[];
}

interface SolscanBlock {
  readonly fee_rewards: string | number;
  readonly transactions_count: number;
  readonly current_slot: number;
  readonly block_height: number;
  readonly block_time: number;
  readonly blockhash: string;
  readonly parent_slot: number;
}

function mapAccountTransaction(raw: Readonly<SolscanAccountTransaction>): Transaction {
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

async function collectAccountTransactions(
  limit: number,
  readPage: (before: string | undefined) => Promise<SolscanAccountTransaction[]>,
): Promise<SolscanAccountTransaction[]> {
  const transactions: SolscanAccountTransaction[] = [];
  const seenCursors = new Set<string>();
  let before: string | undefined;

  while (transactions.length < limit) {
    const page = await readPage(before);
    const cursor = page.at(-1)?.tx_hash;
    if (cursor !== undefined && seenCursors.has(cursor)) break;
    transactions.push(...page.slice(0, limit - transactions.length));
    if (page.length < TRANSACTION_PAGE_SIZE || cursor === undefined) break;
    seenCursors.add(cursor);
    before = cursor;
  }
  return transactions;
}

function mapTransactionDetail(raw: Readonly<SolscanTransactionDetail>): Transaction {
  const signer = typeof raw.signer === "string" ? raw.signer : (raw.signer[0] ?? "");
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

export class Solscan extends Provider {
  static readonly key = "solscan";

  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: Readonly<ProviderConfig>) {
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
    params: Readonly<Record<string, string | number | undefined>>,
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
    return this.snapshotBalance({
      address,
      chain: "solana",
      balance,
      balanceFormatted: formatWei(balance, 9),
      symbol: "SOL",
    });
  }

  async getTxHistory(
    address: string,
    chain?: ChainKey,
    options?: Readonly<TxHistoryOptions>,
  ): Promise<Transaction[]> {
    const c = chain ?? "solana";
    if (c !== "solana") throw new UnsupportedChainError(c, this.name);
    assertSafePathSegment(address, "address");

    const limit = clampMaxResults(options?.limit);
    const transactions = await collectAccountTransactions(limit, (before) =>
      this.api<SolscanAccountTransaction[]>("/account/transactions", {
        address,
        before,
        limit: TRANSACTION_PAGE_SIZE,
      }),
    );
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
