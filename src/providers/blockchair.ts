/**
 * Blockchair provider — multi-chain block explorer
 *
 * Supports Bitcoin, Ethereum and eCash. Free tier: limited requests, dashboard queries. Auth:
 * optional BLOCKCHAIR_API_KEY for higher limits.
 */

import type {
  ProviderCapabilities,
  ProviderConfig,
  ChainKey,
  Balance,
  Transaction,
  TxHistoryOptions,
  TxStatus,
  BlockInfo,
} from "../core/types.js";
import { Provider } from "../core/provider.js";
import { NotFoundError, UnsupportedChainError } from "../core/errors.js";
import { buildQuery, normalizeBaseUrl } from "../core/client.js";
import { create as createChain } from "@agntn/chains";
import { formatWei, clampMaxResults } from "../core/types.js";
import { assertSafePathSegment } from "../core/path-safety.js";

const CHAIN_NAMES: Partial<Record<ChainKey, string>> = {
  bitcoin: "bitcoin",
  ethereum: "ethereum",
  ecash: "ecash",
};

/** Blockchair's UTXO-shaped chains and their base-unit decimals. */
const UTXO_DECIMALS: Partial<Record<ChainKey, number>> = {
  bitcoin: 8,
  ecash: 2,
};

const DEFAULT_BASE = "https://api.blockchair.com";

interface BlockchairResponse<T> {
  readonly data: T;
  readonly context: {
    readonly code: number;
    readonly error?: string;
    readonly limit?: string;
    readonly offset?: string;
    readonly state?: number;
  };
}

interface BlockchairAddressData {
  readonly address: {
    readonly type: string;
    readonly address: string;
    readonly balance: string | number;
    readonly balance_usd?: number;
    readonly received: string | number;
    readonly spent: string | number;
    readonly unspent_output_count: number;
    readonly first_seen_receiving?: string;
    readonly last_seen_receiving?: string;
    readonly transaction_count: number;
    readonly output_count: number;
    // ETH-specific
    readonly call_count?: number;
    readonly type_is_contract?: boolean;
  };
  readonly transactions?: readonly string[];
  readonly utxo?: ReadonlyArray<{
    readonly block_id: number;
    readonly transaction_hash: string;
    readonly index: number;
    readonly value: number;
  }>;
}

interface BlockchairTxData {
  readonly transaction: {
    readonly hash: string;
    readonly block_id: number;
    readonly time: string;
    readonly output_total?: string | number;
    readonly fee: string | number;
    readonly sender?: string;
    readonly recipient?: string | null;
    readonly value?: string;
    readonly gas_used?: number;
    readonly gas_price?: string | number;
    readonly failed?: boolean;
    readonly input_hex?: string;
  };
}

interface BlockchairDashboardsBlocks {
  readonly blocks: ReadonlyArray<{
    readonly id: number;
    readonly hash: string;
    readonly parent_hash: string;
    readonly time: string;
    readonly miner?: string;
    readonly size: number;
    readonly weight?: number;
    readonly version: number;
    readonly merkle_root: string;
    readonly bits: string;
    readonly nonce: number;
    readonly tx_count: number;
    // ETH-specific
    readonly gas_used?: string | number;
    readonly gas_limit?: string | number;
    readonly base_fee_per_gas?: string | number;
    readonly difficulty?: string;
    readonly reward?: number;
  }>;
}

function chainName(chain: ChainKey): string {
  const name = CHAIN_NAMES[chain];
  if (!name) throw new UnsupportedChainError(chain, "blockchair");
  return name;
}

function toIsoTimestamp(timestamp: string): string {
  return new Date(`${timestamp.replace(" ", "T")}Z`).toISOString();
}

function firstRecord<T>(data: Readonly<Record<string, T>>): T | undefined {
  const key = Object.keys(data)[0];
  return key === undefined ? undefined : data[key];
}

async function fetchTransactionDetails(
  hashes: readonly string[],
  read: (hash: string) => Promise<Transaction>,
): Promise<Transaction[]> {
  const transactions: Transaction[] = [];
  for (const hash of hashes) {
    try {
      transactions.push(await read(hash));
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
    }
  }
  return transactions;
}

function blockchairStatus(data: Readonly<BlockchairTxData["transaction"]>): TxStatus {
  if (data.block_id < 0) return "pending";
  return data.failed === true ? "failed" : "success";
}

function transactionValue(
  data: Readonly<BlockchairTxData["transaction"]>,
  decimals: number | undefined,
): string {
  return decimals === undefined ? (data.value ?? "0") : String(data.output_total ?? 0);
}

function isBlockchairContractCall(
  data: Readonly<BlockchairTxData["transaction"]>,
  decimals: number | undefined,
): boolean {
  return decimals === undefined && (data.input_hex?.length ?? 0) > 0;
}

function mapTransactionData(
  data: Readonly<BlockchairTxData["transaction"]>,
  chain: ChainKey,
): Transaction {
  const decimals = UTXO_DECIMALS[chain];
  const value = transactionValue(data, decimals);
  return {
    hash: data.hash,
    blockNumber: data.block_id,
    timestamp: toIsoTimestamp(data.time),
    from: data.sender ?? "",
    to: data.recipient ?? null,
    value,
    valueFormatted: formatWei(value, decimals ?? 18),
    gasUsed: data.gas_used?.toString(),
    gasPrice: data.gas_price?.toString(),
    fee: String(data.fee),
    status: blockchairStatus(data),
    isContractInteraction: isBlockchairContractCall(data, decimals),
    tokenTransfers: [],
    raw: data as unknown as Record<string, unknown>,
  };
}

export class Blockchair extends Provider {
  static readonly key = "blockchair";

  private apiKey: string | undefined;
  private readonly baseUrl: string;
  private defaultChain: ChainKey;

  constructor(config: Readonly<ProviderConfig>) {
    super(config);
    this.apiKey = config.apiKey ?? process.env.BLOCKCHAIR_API_KEY;
    this.baseUrl = normalizeBaseUrl(config.baseUrl ?? DEFAULT_BASE);
    this.defaultChain = config.defaultChain ?? "ethereum";
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

  private buildUrl(
    chain: ChainKey,
    path: string,
    params: Readonly<Record<string, string | number | undefined>> = {},
  ): string {
    const cn = chainName(chain);
    const base = `${this.baseUrl}/${cn}`;
    const query = buildQuery({
      key: this.apiKey,
      ...params,
    });
    return `${base}${path}${query}`;
  }

  async getBalance(address: string, chain?: ChainKey): Promise<Balance> {
    const c = chain ?? this.defaultChain;
    assertSafePathSegment(address, "address");
    const url = this.buildUrl(c, `/dashboards/address/${encodeURIComponent(address)}`);
    const res = await this.getJSON<BlockchairResponse<Record<string, BlockchairAddressData>>>(url);

    const key = Object.keys(res.data)[0];
    if (!key) throw new NotFoundError(`Address ${address}`, "blockchair");
    const data = res.data[key];
    if (!data) throw new NotFoundError(`Address ${address}`, "blockchair");
    const balance = String(data.address.balance);
    const utxoTotals =
      UTXO_DECIMALS[c] === undefined
        ? {}
        : {
            funded: String(data.address.received),
            spent: String(data.address.spent),
          };

    return this.snapshotBalance(
      {
        address,
        chain: c,
        balance,
        balanceFormatted: formatWei(balance, UTXO_DECIMALS[c] ?? 18),
        ...utxoTotals,
        symbol: createChain(c).symbol,
      },
      res.context.state === undefined ? {} : { blockNumber: res.context.state },
    );
  }

  async getTxHistory(
    address: string,
    chain?: ChainKey,
    options?: Readonly<TxHistoryOptions>,
  ): Promise<Transaction[]> {
    const c = chain ?? this.defaultChain;
    assertSafePathSegment(address, "address");
    const limit = clampMaxResults(options?.limit);
    const url = this.buildUrl(c, `/dashboards/address/${encodeURIComponent(address)}`, {
      limit,
    });
    const res = await this.getJSON<BlockchairResponse<Record<string, BlockchairAddressData>>>(url);

    const transactions = firstRecord(res.data)?.transactions;
    if (!transactions?.length) return [];

    return fetchTransactionDetails(transactions.slice(0, limit), (hash) =>
      this.getTxDetail(hash, c),
    );
  }

  override async getTxDetail(hash: string, chain?: ChainKey): Promise<Transaction> {
    const c = chain ?? this.defaultChain;
    assertSafePathSegment(hash, "tx hash");
    const url = this.buildUrl(c, `/dashboards/transaction/${encodeURIComponent(hash)}`);
    const res = await this.getJSON<BlockchairResponse<Record<string, BlockchairTxData>>>(url);

    const entry = firstRecord(res.data);
    if (!entry) throw new NotFoundError(`Transaction ${hash}`, "blockchair");
    return mapTransactionData(entry.transaction, c);
  }

  override async getBlockInfo(blockNumber: number, chain?: ChainKey): Promise<BlockInfo> {
    const c = chain ?? this.defaultChain;
    assertSafePathSegment(String(blockNumber), "block number");
    const url = this.buildUrl(c, `/dashboards/blocks/${encodeURIComponent(String(blockNumber))}`);
    const res = await this.getJSON<BlockchairResponse<BlockchairDashboardsBlocks>>(url);

    const block = res.data.blocks[0];
    if (!block) throw new NotFoundError(`Block ${blockNumber}`, "blockchair");

    return {
      number: block.id,
      hash: block.hash,
      parentHash: block.parent_hash,
      timestamp: toIsoTimestamp(block.time),
      miner: block.miner ?? "",
      gasUsed: (block.gas_used ?? 0).toString(),
      gasLimit: (block.gas_limit ?? 0).toString(),
      txCount: block.tx_count,
      baseFee: block.base_fee_per_gas?.toString(),
    };
  }
}
