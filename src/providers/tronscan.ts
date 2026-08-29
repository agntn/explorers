/**
 * TRONSCAN provider — indexed TRON explorer API.
 *
 * https://docs.tronscan.org/en/api
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
import { AuthError, NotFoundError, UnsupportedChainError } from "../core/errors.js";
import { assertSafePathSegment } from "../core/path-safety.js";
import { clampMaxResults, formatWei } from "../core/types.js";

const DEFAULT_BASE = "https://apilist.tronscanapi.com";

interface TronscanAccount {
  readonly address: string;
  readonly balance?: string | number;
  readonly balanceStr?: string;
}

interface TronscanTransaction {
  readonly hash: string;
  readonly timestamp: number;
  readonly block: number;
  readonly ownerAddress?: string;
  readonly toAddress?: string;
  readonly contractType?: number;
  readonly confirmed?: boolean;
  readonly revert?: boolean;
  readonly contractRet?: string;
  readonly amount?: string | number;
  readonly cost?: {
    readonly fee?: string | number;
    readonly net_fee?: string | number;
  };
}

interface TronscanBlock {
  readonly number: number;
  readonly hash: string;
  readonly timestamp: number;
  readonly nrOfTrx: number;
  readonly witnessAddress?: string;
}

function transactionStatus(raw: Readonly<TronscanTransaction>): TxStatus {
  if (raw.confirmed === false) return "pending";
  return raw.contractRet === "SUCCESS" && raw.revert !== true ? "success" : "failed";
}

function transactionFee(raw: Readonly<TronscanTransaction>): string | undefined {
  const fee = raw.cost?.fee ?? raw.cost?.net_fee;
  return fee === undefined ? undefined : String(fee);
}

function mapTransaction(raw: Readonly<TronscanTransaction>): Transaction {
  const value = String(raw.amount ?? 0);
  return {
    hash: raw.hash,
    blockNumber: raw.block,
    timestamp: new Date(raw.timestamp).toISOString(),
    from: raw.ownerAddress ?? "",
    to: raw.toAddress ?? null,
    value,
    valueFormatted: formatWei(value, 6),
    fee: transactionFee(raw),
    status: transactionStatus(raw),
    isContractInteraction: raw.contractType !== undefined && raw.contractType !== 1,
    tokenTransfers: [],
    raw: raw as unknown as Record<string, unknown>,
  };
}

export class Tronscan extends Provider {
  static readonly key = "tronscan";

  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: Readonly<ProviderConfig>) {
    super(config);
    const apiKey = config.apiKey ?? process.env.TRONSCAN_API_KEY ?? "";
    if (!apiKey) {
      throw new AuthError("tronscan", "Set TRONSCAN_API_KEY or pass apiKey in config");
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

  private api<T>(
    path: string,
    params: Readonly<Record<string, string | number | undefined>>,
  ): Promise<T> {
    return this.getJSON<T>(`${this.baseUrl}${path}${buildQuery(params)}`, {
      headers: { "TRON-PRO-API-KEY": this.apiKey },
    });
  }

  async getBalance(address: string, chain?: ChainKey): Promise<Balance> {
    const c = chain ?? "tron";
    if (c !== "tron") throw new UnsupportedChainError(c, this.name);
    assertSafePathSegment(address, "address");

    const account = await this.api<TronscanAccount>("/api/accountv2", { address });
    const balance = account.balanceStr ?? String(account.balance ?? 0);
    return this.snapshotBalance({
      address,
      chain: "tron",
      balance,
      balanceFormatted: formatWei(balance, 6),
      symbol: "TRX",
    });
  }

  async getTxHistory(
    address: string,
    chain?: ChainKey,
    options?: Readonly<TxHistoryOptions>,
  ): Promise<Transaction[]> {
    const c = chain ?? "tron";
    if (c !== "tron") throw new UnsupportedChainError(c, this.name);
    assertSafePathSegment(address, "address");

    const response = await this.api<{ data: TronscanTransaction[] }>("/api/transaction", {
      address,
      limit: clampMaxResults(options?.limit, 50),
      start: 0,
      sort: options?.sort === "asc" ? "timestamp" : "-timestamp",
    });
    return response.data.map(mapTransaction);
  }

  override async getTxDetail(hash: string, chain?: ChainKey): Promise<Transaction> {
    const c = chain ?? "tron";
    if (c !== "tron") throw new UnsupportedChainError(c, this.name);
    assertSafePathSegment(hash, "tx hash");

    const transaction = await this.api<TronscanTransaction>("/api/transaction-info", { hash });
    if (!transaction.hash) throw new NotFoundError(`Transaction ${hash}`, this.name);
    return mapTransaction(transaction);
  }

  override async getBlockInfo(blockNumber: number, chain?: ChainKey): Promise<BlockInfo> {
    const c = chain ?? "tron";
    if (c !== "tron") throw new UnsupportedChainError(c, this.name);
    assertSafePathSegment(String(blockNumber), "block number");

    const response = await this.api<{ data: TronscanBlock[] }>("/api/block", {
      number: blockNumber,
    });
    const block = response.data[0];
    if (!block) throw new NotFoundError(`Block ${blockNumber}`, this.name);
    return {
      number: block.number,
      hash: block.hash,
      parentHash: "",
      timestamp: new Date(block.timestamp).toISOString(),
      miner: block.witnessAddress ?? "",
      gasUsed: "0",
      gasLimit: "0",
      txCount: block.nrOfTrx,
    };
  }
}
