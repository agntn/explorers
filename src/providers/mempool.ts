/**
 * Mempool.space provider — Bitcoin block explorer
 *
 * Public API, no key needed. Best-in-class Bitcoin data:
 * address balances, tx history, UTXO info, fee estimates, block info.
 *
 * https://mempool.space/docs/api
 */

import type {
  ProviderCapabilities,
  ProviderConfig,
  Chain,
  Balance,
  Transaction,
  TxHistoryOptions,
  GasData,
  BlockInfo,
  TxStatus,
  TokenTransfer,
} from "../core/types.js";
import { Provider } from "../core/provider.js";
import { normalizeBaseUrl } from "../core/client.js";
import { UnsupportedChainError } from "../core/errors.js";
import { register } from "../core/registry.js";
import { clampMaxResults, formatWei } from "../core/types.js";
import { assertSafePathSegment } from "../core/path-safety.js";

const DEFAULT_BASE = "https://mempool.space";

interface MempoolAddressSummary {
  address: string;
  chain_stats: {
    funded_txo_count: number;
    funded_txo_sum: number;
    spent_txo_count: number;
    spent_txo_sum: number;
    tx_count: number;
  };
  mempool_stats: {
    funded_txo_count: number;
    funded_txo_sum: number;
    spent_txo_count: number;
    spent_txo_sum: number;
    tx_count: number;
  };
}

interface MempoolTx {
  txid: string;
  version: number;
  locktime: number;
  vin: Array<{
    txid: string;
    vout: number;
    prevout: {
      scriptpubkey: string;
      scriptpubkey_asm: string;
      scriptpubkey_type: string;
      scriptpubkey_address?: string;
      value: number;
    };
    scriptsig: string;
    sequence: number;
    witness?: string[];
  }>;
  vout: Array<{
    scriptpubkey: string;
    scriptpubkey_asm: string;
    scriptpubkey_type: string;
    scriptpubkey_address?: string;
    value: number;
  }>;
  size: number;
  weight: number;
  fee: number;
  status: {
    confirmed: boolean;
    block_height?: number;
    block_hash?: string;
    block_time?: number;
  };
}

interface MempoolAddressTx {
  txid: string;
  version: number;
  locktime: number;
  vin: Array<{
    txid: string;
    vout: number;
    prevout: {
      scriptpubkey_address?: string;
      value: number;
    };
    scriptsig: string;
    sequence: number;
  }>;
  vout: Array<{
    scriptpubkey_address?: string;
    value: number;
  }>;
  size: number;
  weight: number;
  fee: number;
  status: {
    confirmed: boolean;
    block_height?: number;
    block_time?: number;
  };
}

interface MempoolFees {
  fastestFee: number;
  halfHourFee: number;
  hourFee: number;
  economyFee: number;
  minimumFee: number;
}

interface MempoolBlock {
  id: string;
  height: number;
  version: number;
  timestamp: number;
  bits: number;
  nonce: number;
  difficulty: number;
  merkle_root: string;
  tx_count: number;
  size: number;
  weight: number;
  previousblockhash: string;
  mediantime: number;
}

/** Convert satoshis to a BTC string without floating-point arithmetic. */
function satToBtc(sat: number): string {
  return formatWei(String(sat), 8);
}

function mapTx(raw: MempoolAddressTx, address: string): Transaction {
  // Determine direction: is this address receiving or sending?
  const totalIn = raw.vin
    .filter((v) => v.prevout.scriptpubkey_address === address)
    .reduce((sum, v) => sum + v.prevout.value, 0);
  const totalOut = raw.vout
    .filter((v) => v.scriptpubkey_address === address)
    .reduce((sum, v) => sum + v.value, 0);

  const netSat = totalOut - totalIn;
  const isSend = totalIn > 0;
  const transferredSat = isSend ? Math.max(0, Math.abs(netSat) - raw.fee) : netSat;

  // Find the primary counterparty
  const from = isSend
    ? (raw.vin.find((v) => v.prevout.scriptpubkey_address === address)?.prevout
        .scriptpubkey_address ?? address)
    : (raw.vin[0]?.prevout.scriptpubkey_address ?? "unknown");
  const to = isSend
    ? (raw.vout.find((v) => v.scriptpubkey_address !== address)?.scriptpubkey_address ?? address)
    : address;

  return {
    hash: raw.txid,
    blockNumber: raw.status.block_height ?? 0,
    timestamp: raw.status.block_time
      ? new Date(raw.status.block_time * 1000).toISOString()
      : undefined,
    from,
    to: to ?? null,
    value: transferredSat.toString(),
    valueFormatted: satToBtc(transferredSat),
    fee: raw.fee.toString(),
    status: (raw.status.confirmed ? "success" : "pending") as TxStatus,
    isContractInteraction: false,
    tokenTransfers: [] as TokenTransfer[],
    raw: raw as unknown as Record<string, unknown>,
  };
}

class Mempool extends Provider {
  static readonly key = "mempool";

  private baseUrl: string;

  constructor(config: ProviderConfig) {
    super(config);
    this.baseUrl = normalizeBaseUrl(config.baseUrl ?? DEFAULT_BASE);
  }
  get capabilities(): ProviderCapabilities {
    return {
      balances: true,
      txHistory: true,
      txDetail: true,
      contractInfo: false,
      tokenBalances: false,
      gasData: true,
      blockInfo: true,
    };
  }

  private async api<T>(path: string): Promise<T> {
    return this.getJSON<T>(`${this.baseUrl}${path}`);
  }

  async getBalance(address: string, chain?: Chain): Promise<Balance> {
    const c = chain ?? "bitcoin";
    if (c !== "bitcoin") throw new UnsupportedChainError(c, "mempool");

    assertSafePathSegment(address, "address");
    const data = await this.api<MempoolAddressSummary>(
      `/api/address/${encodeURIComponent(address)}`,
    );

    const fundedSat = data.chain_stats.funded_txo_sum;
    const spentSat = data.chain_stats.spent_txo_sum;
    const balanceSat = fundedSat - spentSat;

    return {
      address,
      chain: "bitcoin",
      balance: balanceSat.toString(),
      balanceFormatted: satToBtc(balanceSat),
      symbol: "BTC",
    };
  }

  async getTxHistory(
    address: string,
    chain?: Chain,
    options?: TxHistoryOptions,
  ): Promise<Transaction[]> {
    const c = chain ?? "bitcoin";
    if (c !== "bitcoin") throw new UnsupportedChainError(c, "mempool");

    const limit = clampMaxResults(options?.limit);
    assertSafePathSegment(address, "address");
    const data = await this.api<MempoolAddressTx[]>(
      `/api/address/${encodeURIComponent(address)}/txs`,
    );

    return data.slice(0, limit).map((tx) => mapTx(tx, address));
  }

  override async getTxDetail(hash: string, chain?: Chain): Promise<Transaction> {
    const c = chain ?? "bitcoin";
    if (c !== "bitcoin") throw new UnsupportedChainError(c, "mempool");

    assertSafePathSegment(hash, "tx hash");
    const data = await this.api<MempoolTx>(`/api/tx/${encodeURIComponent(hash)}`);

    const totalOut = data.vout.reduce((sum, v) => sum + v.value, 0);
    const fromAddr = data.vin[0]?.prevout.scriptpubkey_address ?? "unknown";
    const toAddr = data.vout[0]?.scriptpubkey_address ?? null;

    return {
      hash: data.txid,
      blockNumber: data.status.block_height ?? 0,
      timestamp: data.status.block_time
        ? new Date(data.status.block_time * 1000).toISOString()
        : undefined,
      from: fromAddr,
      to: toAddr,
      value: totalOut.toString(),
      valueFormatted: satToBtc(totalOut),
      fee: data.fee.toString(),
      status: (data.status.confirmed ? "success" : "pending") as TxStatus,
      isContractInteraction: false,
      tokenTransfers: [],
      raw: data as unknown as Record<string, unknown>,
    };
  }

  override async getGasData(chain?: Chain): Promise<GasData> {
    const c = chain ?? "bitcoin";
    if (c !== "bitcoin") throw new UnsupportedChainError(c, "mempool");

    const fees = await this.api<MempoolFees>("/api/v1/fees/recommended");

    return {
      chain: "bitcoin",
      unit: "sat/vB",
      safeGasPrice: fees.economyFee.toString(),
      proposedGasPrice: fees.halfHourFee.toString(),
      fastGasPrice: fees.fastestFee.toString(),
      priorityFee: fees.minimumFee.toString(),
    };
  }

  override async getBlockInfo(blockNumber: number, chain?: Chain): Promise<BlockInfo> {
    const c = chain ?? "bitcoin";
    if (c !== "bitcoin") throw new UnsupportedChainError(c, "mempool");

    // Get block hash from height, then fetch block details.
    // Block numbers are ASCII hex from mempool.space — no traversal concern,
    // but assert anyway for symmetry with sibling providers.
    assertSafePathSegment(String(blockNumber), "block number");
    const blockHash = await this.api<string>(
      `/api/block-height/${encodeURIComponent(String(blockNumber))}`,
    );
    const data = await this.api<MempoolBlock>(`/api/block/${encodeURIComponent(blockHash)}`);

    return {
      number: data.height,
      hash: data.id,
      parentHash: data.previousblockhash,
      timestamp: new Date(data.timestamp * 1000).toISOString(),
      miner: "", // Mempool doesn't provide miner directly
      gasUsed: data.size.toString(),
      gasLimit: data.weight.toString(),
      txCount: data.tx_count,
    };
  }
}

register(Mempool, "https://mempool.space");
