/**
 * TRON provider — TronGrid public API
 *
 * Public REST API, no key needed. TRX balance, tx history, block info.
 * Tron uses SUN units: 1 TRX = 1,000,000 SUN.
 *
 * https://developers.tron.network/reference
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
  BlockInfo,
  TxStatus,
} from '../core/types.js'
import { getJSON } from '../core/client.js'
import { normalizeError, UnsupportedChainError } from '../core/errors.js'
import { register } from '../core/registry.js'
import { clampMaxResults } from '../core/types.js'

import { assertSafePathSegment } from '../core/path-safety.js'
const DEFAULT_BASE = 'https://api.trongrid.io'
const SUN_PER_TRX = 1_000_000

// ─── TronGrid API types ────────────────────────────────────────────────────

interface TronAccount {
  address: string
  balance: number
  account_name?: string
  type?: string
  latest_operation_time?: number
  frozenV2?: unknown[]
  trc20?: Array<Record<string, string>>
}

interface TronTxContract {
  type: string
  parameter: {
    value: {
      owner_address?: string
      to_address?: string
      amount?: number
      contract_address?: string
      data?: string
    }
    type_url: string
  }
}

interface TronTx {
  txID: string
  blockNumber?: number
  block_timestamp: number
  ret: Array<{ contractRet: string }>
  raw_data: {
    contract: TronTxContract[]
    ref_block_bytes?: string
    ref_block_hash?: string
    expiration?: number
    fee_limit?: number
  }
  raw_data_hex?: string
  energy_usage?: number
  energy_fee?: number
  net_usage?: number
  net_fee?: number
}

interface TronBlock {
  block_header: {
    raw_data: {
      number: number
      timestamp: number
      txTrieRoot: string
      parentHash: string
      version: number
      witness_address: string
    }
    witness_signature: string
  }
  blockid: string
  transactions?: unknown[]
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function sunToTrx(sun: number): string {
  return (sun / SUN_PER_TRX).toFixed(6).replace(/\.?0+$/, '') || '0'
}

function mapTx(raw: TronTx): Transaction {
  const contract = raw.raw_data.contract[0]
  const value = contract?.parameter.value
  const amount = value?.amount ?? 0

  return {
    hash: raw.txID,
    blockNumber: raw.blockNumber ?? 0,
    timestamp: new Date(raw.block_timestamp).toISOString(),
    from: value?.owner_address ?? '',
    to: value?.to_address ?? null,
    value: amount.toString(),
    valueFormatted: sunToTrx(amount),
    status: (raw.ret?.[0]?.contractRet === 'SUCCESS' ? 'success' : 'failed') as TxStatus,
    isContractInteraction: contract?.type !== 'TransferContract',
    tokenTransfers: [],
  }
}

// ─── Provider ──────────────────────────────────────────────────────────────

class TronProvider implements BlocexProvider {
  private baseUrl: string

  constructor(config: ProviderConfig) {
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE
  }

  name(): string {
    return 'tron'
  }

  capabilities(): ProviderCapabilities {
    return {
      balances: true,
      txHistory: true,
      txDetail: false,
      contractInfo: false,
      tokenBalances: false,
      gasData: false,
      blockInfo: true,
    }
  }

  async getBalance(address: string, chain?: Chain): Promise<Balance> {
    const c = chain ?? 'tron'
    if (c !== 'tron') throw new UnsupportedChainError(c, 'tron')

    assertSafePathSegment(address, 'address')
    const data = await getJSON<{ data: TronAccount[] }>(
      `${this.baseUrl}/v1/accounts/${encodeURIComponent(address)}`,
    )

    const account = data.data?.[0]
    const balance = account?.balance ?? 0

    return {
      address,
      chain: 'tron',
      balance: balance.toString(),
      balanceFormatted: sunToTrx(balance),
      symbol: 'TRX',
    }
  }

  async getTxHistory(address: string, chain?: Chain, options?: TxHistoryOptions): Promise<Transaction[]> {
    const c = chain ?? 'tron'
    if (c !== 'tron') throw new UnsupportedChainError(c, 'tron')

    const limit = clampMaxResults(options?.limit)

    assertSafePathSegment(address, 'address')
    const data = await getJSON<{ data: TronTx[] }>(
      `${this.baseUrl}/v1/accounts/${encodeURIComponent(address)}/transactions?limit=${limit}&order_by=block_timestamp,desc`,
    )

    if (!data.data?.length) return []

    return data.data.map(mapTx)
  }

  async getTxDetail(_hash: string, _chain?: Chain): Promise<Transaction> {
    throw normalizeError(new Error('TRON tx detail not yet supported — use tx history'), 'tron')
  }

  async getContractInfo(_address: string, _chain?: Chain): Promise<ContractInfo> {
    throw new UnsupportedChainError('tron', 'tron')
  }

  async getBlockInfo(blockNumber: number, chain?: Chain): Promise<BlockInfo> {
    const c = chain ?? 'tron'
    if (c !== 'tron') throw new UnsupportedChainError(c, 'tron')

    assertSafePathSegment(String(blockNumber), 'block number')
    const data = await getJSON<TronBlock>(
      `${this.baseUrl}/wallet/getblockbynum?num=${encodeURIComponent(String(blockNumber))}`,
    )

    const raw = data.block_header.raw_data

    return {
      number: raw.number,
      hash: data.blockid,
      parentHash: raw.parentHash,
      timestamp: new Date(raw.timestamp).toISOString(),
      miner: raw.witness_address,
      gasUsed: '0',
      gasLimit: '0',
      txCount: data.transactions?.length ?? 0,
    }
  }
}

// ─── Register ──────────────────────────────────────────────────────────────

const factory = (config: ProviderConfig) => new TronProvider(config)
register('tron', factory, 'https://api.trongrid.io')
