/**
 * Mempool.space provider — Bitcoin block explorer
 *
 * Public API, no key needed. Best-in-class Bitcoin data:
 * address balances, tx history, UTXO info, fee estimates, block info.
 *
 * https://mempool.space/docs/api
 */

import type {
  BlocexProvider,
  ProviderCapabilities,
  ProviderConfig,
  Chain,
  Balance,
  Transaction,
  TxHistoryOptions,
  ContractInfo,
  GasData,
  BlockInfo,
  TxStatus,
  TokenTransfer,
} from '../core/types.js'
import { getJSON } from '../core/client.js'
import { normalizeError, UnsupportedChainError } from '../core/errors.js'
import { register } from '../core/registry.js'
import { clampMaxResults } from '../core/types.js'

const DEFAULT_BASE = 'https://mempool.space'

// ─── Mempool.space API types ───────────────────────────────────────────────

interface MempoolAddressSummary {
  address: string
  chain_stats: {
    funded_txo_count: number
    funded_txo_sum: number
    spent_txo_count: number
    spent_txo_sum: number
    tx_count: number
  }
  mempool_stats: {
    funded_txo_count: number
    funded_txo_sum: number
    spent_txo_count: number
    spent_txo_sum: number
    tx_count: number
  }
}

interface MempoolTx {
  txid: string
  version: number
  locktime: number
  vin: Array<{
    txid: string
    vout: number
    prevout: {
      scriptpubkey: string
      scriptpubkey_asm: string
      scriptpubkey_type: string
      scriptpubkey_address?: string
      value: number
    }
    scriptsig: string
    sequence: number
    witness?: string[]
  }>
  vout: Array<{
    scriptpubkey: string
    scriptpubkey_asm: string
    scriptpubkey_type: string
    scriptpubkey_address?: string
    value: number
  }>
  size: number
  weight: number
  fee: number
  status: {
    confirmed: boolean
    block_height?: number
    block_hash?: string
    block_time?: number
  }
}

interface MempoolAddressTx {
  txid: string
  version: number
  locktime: number
  vin: Array<{
    txid: string
    vout: number
    prevout: {
      scriptpubkey_address?: string
      value: number
    }
    scriptsig: string
    sequence: number
  }>
  vout: Array<{
    scriptpubkey_address?: string
    value: number
  }>
  size: number
  weight: number
  fee: number
  status: {
    confirmed: boolean
    block_height?: number
    block_time?: number
  }
}

interface MempoolFees {
  fastestFee: number
  halfHourFee: number
  hourFee: number
  economyFee: number
  minimumFee: number
}

interface MempoolBlock {
  id: string
  height: number
  version: number
  timestamp: number
  bits: number
  nonce: number
  difficulty: number
  merkle_root: string
  tx_count: number
  size: number
  weight: number
  previousblockhash: string
  mediantime: number
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Convert satoshis to BTC string */
function satToBtc(sat: number): string {
  const btc = sat / 100_000_000
  return btc.toFixed(8).replace(/\.?0+$/, '') || '0'
}

function mapTx(raw: MempoolAddressTx, address: string): Transaction {
  // Determine direction: is this address receiving or sending?
  const totalIn = raw.vin
    .filter(v => v.prevout.scriptpubkey_address === address)
    .reduce((sum, v) => sum + v.prevout.value, 0)
  const totalOut = raw.vout
    .filter(v => v.scriptpubkey_address === address)
    .reduce((sum, v) => sum + v.value, 0)

  const netSat = totalOut - totalIn
  const isSend = totalIn > 0

  // Find the primary counterparty
  const from = isSend
    ? (raw.vin.find(v => v.prevout.scriptpubkey_address === address)?.prevout.scriptpubkey_address ?? address)
    : (raw.vin[0]?.prevout.scriptpubkey_address ?? 'unknown')
  const to = isSend
    ? (raw.vout.find(v => v.scriptpubkey_address !== address)?.scriptpubkey_address ?? address)
    : address

  return {
    hash: raw.txid,
    blockNumber: raw.status.block_height ?? 0,
    timestamp: raw.status.block_time
      ? new Date(raw.status.block_time * 1000).toISOString()
      : undefined,
    from,
    to: to ?? null,
    value: Math.abs(netSat).toString(),
    valueFormatted: satToBtc(Math.abs(netSat)),
    gasUsed: undefined,
    gasPrice: undefined,
    status: (raw.status.confirmed ? 'success' : 'pending') as TxStatus,
    isContractInteraction: false,
    tokenTransfers: [] as TokenTransfer[],
  }
}

// ─── Provider ──────────────────────────────────────────────────────────────

class MempoolProvider implements BlocexProvider {
  private baseUrl: string

  constructor(config: ProviderConfig) {
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE
  }

  name(): string {
    return 'mempool'
  }

  capabilities(): ProviderCapabilities {
    return {
      balances: true,
      txHistory: true,
      txDetail: true,
      contractInfo: false,
      tokenBalances: false,
      gasData: true,
      blockInfo: true,
    }
  }

  private async api<T>(path: string): Promise<T> {
    return getJSON<T>(`${this.baseUrl}${path}`)
  }

  async getBalance(address: string, chain?: Chain): Promise<Balance> {
    const c = chain ?? 'bitcoin'
    if (c !== 'bitcoin') throw new UnsupportedChainError(c, 'mempool')

    const data = await this.api<MempoolAddressSummary>(`/api/address/${address}`)

    const fundedSat = data.chain_stats.funded_txo_sum
    const spentSat = data.chain_stats.spent_txo_sum
    const balanceSat = fundedSat - spentSat

    return {
      address,
      chain: 'bitcoin',
      balance: balanceSat.toString(),
      balanceFormatted: satToBtc(balanceSat),
      symbol: 'BTC',
    }
  }

  async getTxHistory(address: string, chain?: Chain, options?: TxHistoryOptions): Promise<Transaction[]> {
    const c = chain ?? 'bitcoin'
    if (c !== 'bitcoin') throw new UnsupportedChainError(c, 'mempool')

    const limit = clampMaxResults(options?.limit)
    const data = await this.api<MempoolAddressTx[]>(`/api/address/${address}/txs`)

    return data.slice(0, limit).map(tx => mapTx(tx, address))
  }

  async getTxDetail(hash: string, chain?: Chain): Promise<Transaction> {
    const c = chain ?? 'bitcoin'
    if (c !== 'bitcoin') throw new UnsupportedChainError(c, 'mempool')

    const data = await this.api<MempoolTx>(`/api/tx/${hash}`)

    const totalOut = data.vout.reduce((sum, v) => sum + v.value, 0)
    const fromAddr = data.vin[0]?.prevout.scriptpubkey_address ?? 'unknown'
    const toAddr = data.vout[0]?.scriptpubkey_address ?? null

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
      gasUsed: data.size.toString(),
      gasPrice: data.fee.toString(),
      status: (data.status.confirmed ? 'success' : 'pending') as TxStatus,
      isContractInteraction: false,
      tokenTransfers: [],
    }
  }

  async getContractInfo(_address: string, _chain?: Chain): Promise<ContractInfo> {
    throw new UnsupportedChainError('bitcoin', 'mempool')
  }

  async getGasData(chain?: Chain): Promise<GasData> {
    const c = chain ?? 'bitcoin'
    if (c !== 'bitcoin') throw new UnsupportedChainError(c, 'mempool')

    const fees = await this.api<MempoolFees>('/api/v1/fees/recommended')

    return {
      chain: 'bitcoin',
      safeGasPrice: fees.economyFee.toString(),
      proposedGasPrice: fees.halfHourFee.toString(),
      fastGasPrice: fees.fastestFee.toString(),
      priorityFee: fees.minimumFee.toString(),
    }
  }

  async getBlockInfo(blockNumber: number, chain?: Chain): Promise<BlockInfo> {
    const c = chain ?? 'bitcoin'
    if (c !== 'bitcoin') throw new UnsupportedChainError(c, 'mempool')

    // Get block hash from height, then fetch block details
    const blockHash = await this.api<string>(`/api/block-height/${blockNumber}`)
    const data = await this.api<MempoolBlock>(`/api/block/${blockHash}`)

    return {
      number: data.height,
      hash: data.id,
      parentHash: data.previousblockhash,
      timestamp: new Date(data.timestamp * 1000).toISOString(),
      miner: '', // Mempool doesn't provide miner directly
      gasUsed: data.size.toString(),
      gasLimit: data.weight.toString(),
      txCount: data.tx_count,
    }
  }
}

// ─── Register ──────────────────────────────────────────────────────────────

const factory = (config: ProviderConfig) => new MempoolProvider(config)
register('mempool', factory, 'https://mempool.space')
