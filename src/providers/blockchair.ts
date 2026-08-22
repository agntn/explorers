/**
 * Blockchair provider — multi-chain block explorer
 *
 * Supports Bitcoin and Ethereum. Free tier: limited requests, dashboard queries. Auth: optional
 * BLOCKCHAIR_API_KEY for higher limits.
 */

import type {
  ProviderCapabilities,
  ProviderConfig,
  ChainKey,
  Balance,
  Transaction,
  TxHistoryOptions,
  BlockInfo,
} from "../core/types.js";
import { Provider } from "../core/provider.js";
import { NotFoundError, UnsupportedChainError } from "../core/errors.js";
import { buildQuery, normalizeBaseUrl } from "../core/client.js";
import { register } from "../core/registry.js";
import { create as createChain } from "@agntn/chains";
import { formatWei, clampMaxResults } from "../core/types.js";
import { assertSafePathSegment } from "../core/path-safety.js";

const CHAIN_NAMES: Partial<Record<ChainKey, string>> = {
  bitcoin: "bitcoin",
  eth: "ethereum",
};

interface BlockchairResponse<T> {
  data: T;
  context: {
    code: number;
    error?: string;
    limit?: string;
    offset?: string;
  };
}

interface BlockchairAddressData {
  address: {
    type: string;
    address: string;
    balance: string | number;
    balance_usd?: number;
    received: string | number;
    spent: string | number;
    unspent_output_count: number;
    first_seen_receiving?: string;
    last_seen_receiving?: string;
    transaction_count: number;
    output_count: number;
    // ETH-specific
    call_count?: number;
    type_is_contract?: boolean;
  };
  transactions?: string[];
  utxo?: Array<{
    block_id: number;
    transaction_hash: string;
    index: number;
    value: number;
  }>;
}

interface BlockchairTxData {
  transaction: {
    hash: string;
    block_id: number;
    time: string;
    output_total?: string | number;
    fee: string | number;
    sender?: string;
    recipient?: string | null;
    value?: string;
    gas_used?: number;
    gas_price?: string | number;
    failed?: boolean;
    input_hex?: string;
  };
}

interface BlockchairDashboardsBlocks {
  blocks: Array<{
    id: number;
    hash: string;
    parent_hash: string;
    time: string;
    miner?: string;
    size: number;
    weight?: number;
    version: number;
    merkle_root: string;
    bits: string;
    nonce: number;
    tx_count: number;
    // ETH-specific
    gas_used?: string | number;
    gas_limit?: string | number;
    base_fee_per_gas?: string | number;
    difficulty?: string;
    reward?: number;
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

class Blockchair extends Provider {
  static readonly key = "blockchair";

  private apiKey: string | undefined;
  private readonly baseUrl: string;
  private defaultChain: ChainKey;

  constructor(config: ProviderConfig) {
    super(config);
    this.apiKey = config.apiKey ?? process.env.BLOCKCHAIR_API_KEY;
    this.baseUrl = normalizeBaseUrl(config.baseUrl ?? "https://api.blockchair.com");
    this.defaultChain = config.defaultChain ?? "eth";
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
    params: Record<string, string | number | undefined> = {},
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

    return {
      address,
      chain: c,
      balance,
      balanceFormatted: formatWei(balance, c === "bitcoin" ? 8 : 18),
      symbol: createChain(c).symbol,
    };
  }

  async getTxHistory(
    address: string,
    chain?: ChainKey,
    options?: TxHistoryOptions,
  ): Promise<Transaction[]> {
    const c = chain ?? this.defaultChain;
    assertSafePathSegment(address, "address");
    const limit = clampMaxResults(options?.limit);
    const url = this.buildUrl(c, `/dashboards/address/${encodeURIComponent(address)}`, {
      limit,
    });
    const res = await this.getJSON<BlockchairResponse<Record<string, BlockchairAddressData>>>(url);

    const key = Object.keys(res.data)[0];
    if (!key) return [];
    const addrData = res.data[key];
    if (!addrData) return [];

    if (!addrData.transactions?.length) return [];

    // Blockchair returns tx hashes for address; fetch details for each.
    // Cap at limit to bound N+1 calls; errors are isolated per-hash so a
    // single bad hash doesn't drop the whole page.
    const txHashes = addrData.transactions.slice(0, limit);
    const txs: Transaction[] = [];

    for (const hash of txHashes) {
      try {
        txs.push(await this.getTxDetail(hash, c));
      } catch (error) {
        if (!(error instanceof NotFoundError)) throw error;
      }
    }

    return txs;
  }

  override async getTxDetail(hash: string, chain?: ChainKey): Promise<Transaction> {
    const c = chain ?? this.defaultChain;
    assertSafePathSegment(hash, "tx hash");
    const url = this.buildUrl(c, `/dashboards/transaction/${encodeURIComponent(hash)}`);
    const res = await this.getJSON<BlockchairResponse<Record<string, BlockchairTxData>>>(url);

    const key = Object.keys(res.data)[0];
    if (!key) throw new NotFoundError(`Transaction ${hash}`, "blockchair");
    const entry = res.data[key];
    if (!entry) throw new NotFoundError(`Transaction ${hash}`, "blockchair");
    const data = entry.transaction;
    const value = c === "bitcoin" ? String(data.output_total ?? 0) : (data.value ?? "0");

    return {
      hash: data.hash,
      blockNumber: data.block_id,
      timestamp: toIsoTimestamp(data.time),
      from: data.sender ?? "",
      to: data.recipient ?? null,
      value,
      valueFormatted: formatWei(value, c === "bitcoin" ? 8 : 18),
      gasUsed: data.gas_used?.toString(),
      gasPrice: data.gas_price?.toString(),
      fee: String(data.fee),
      status: data.block_id < 0 ? "pending" : data.failed === true ? "failed" : "success",
      isContractInteraction: c !== "bitcoin" && (data.input_hex?.length ?? 0) > 0,
      tokenTransfers: [],
      raw: data as unknown as Record<string, unknown>,
    };
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

register(Blockchair, "https://api.blockchair.com");
