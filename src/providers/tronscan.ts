/**
 * TRONSCAN provider — indexed TRON explorer API.
 *
 * https://docs.tronscan.org/en/api
 */

import type {
  Balance,
  BlockInfo,
  Chain,
  ProviderCapabilities,
  ProviderConfig,
  Transaction,
  TxHistoryOptions,
  TxStatus,
} from "../core/types.js";
import { Provider } from "../core/provider.js";
import { normalizeBaseUrl, buildQuery } from "../core/client.js";
import { AuthError, NotFoundError, UnsupportedChainError } from "../core/errors.js";
import { register } from "../core/registry.js";
import { assertSafePathSegment } from "../core/path-safety.js";
import { clampMaxResults, formatWei } from "../core/types.js";

const DEFAULT_BASE = "https://apilist.tronscanapi.com";

interface TronscanAccount {
  address: string;
  balance?: string | number;
  balanceStr?: string;
}

interface TronscanTransaction {
  hash: string;
  timestamp: number;
  block: number;
  ownerAddress?: string;
  toAddress?: string;
  contractType?: number;
  confirmed?: boolean;
  revert?: boolean;
  contractRet?: string;
  amount?: string | number;
  cost?: {
    fee?: string | number;
    net_fee?: string | number;
  };
}

interface TronscanBlock {
  number: number;
  hash: string;
  timestamp: number;
  nrOfTrx: number;
  witnessAddress?: string;
}

function mapTransaction(raw: TronscanTransaction): Transaction {
  const value = String(raw.amount ?? 0);
  const fee = raw.cost?.fee ?? raw.cost?.net_fee;
  const succeeded = raw.contractRet === "SUCCESS" && raw.revert !== true;
  return {
    hash: raw.hash,
    blockNumber: raw.block,
    timestamp: new Date(raw.timestamp).toISOString(),
    from: raw.ownerAddress ?? "",
    to: raw.toAddress ?? null,
    value,
    valueFormatted: formatWei(value, 6),
    fee: fee === undefined ? undefined : String(fee),
    status: (succeeded ? "success" : "failed") as TxStatus,
    isContractInteraction: raw.contractType !== undefined && raw.contractType !== 1,
    tokenTransfers: [],
    raw: raw as unknown as Record<string, unknown>,
  };
}

class Tronscan extends Provider {
  static readonly key = "tronscan";

  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: ProviderConfig) {
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
      gasData: false,
      blockInfo: true,
    };
  }

  private api<T>(path: string, params: Record<string, string | number | undefined>): Promise<T> {
    return this.getJSON<T>(`${this.baseUrl}${path}${buildQuery(params)}`, {
      headers: { "TRON-PRO-API-KEY": this.apiKey },
    });
  }

  async getBalance(address: string, chain?: Chain): Promise<Balance> {
    const c = chain ?? "tron";
    if (c !== "tron") throw new UnsupportedChainError(c, this.name);
    assertSafePathSegment(address, "address");

    const account = await this.api<TronscanAccount>("/api/accountv2", { address });
    const balance = account.balanceStr ?? String(account.balance ?? 0);
    return {
      address,
      chain: "tron",
      balance,
      balanceFormatted: formatWei(balance, 6),
      symbol: "TRX",
    };
  }

  async getTxHistory(
    address: string,
    chain?: Chain,
    options?: TxHistoryOptions,
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

  override async getTxDetail(hash: string, chain?: Chain): Promise<Transaction> {
    const c = chain ?? "tron";
    if (c !== "tron") throw new UnsupportedChainError(c, this.name);
    assertSafePathSegment(hash, "tx hash");

    const transaction = await this.api<TronscanTransaction>("/api/transaction-info", { hash });
    if (!transaction.hash) throw new NotFoundError(`Transaction ${hash}`, this.name);
    return mapTransaction(transaction);
  }

  override async getBlockInfo(blockNumber: number, chain?: Chain): Promise<BlockInfo> {
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

register(Tronscan, DEFAULT_BASE);
