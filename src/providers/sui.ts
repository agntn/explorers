/**
 * Sui provider — Sui public JSON-RPC
 *
 * Public RPC, no key needed. SUI balance, tx history, tx detail, block info.
 * Sui uses MIST: 1 SUI = 1,000,000,000 MIST.
 *
 * https://docs.sui.io/references/sui-api
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
} from '../core/types.js'
import { normalizeError, UnsupportedChainError } from '../core/errors.js'
import { register } from '../core/registry.js'
import { clampMaxResults } from '../core/types.js'

const DEFAULT_RPC = 'https://fullnode.mainnet.sui.io:443'
const MIST_PER_SUI = 1_000_000_000

// ─── Sui RPC types ─────────────────────────────────────────────────────────

interface RpcResponse<T> {
  jsonrpc: string
  id: number
  result?: T
  error?: { code: number; message: string; data?: unknown }
}

interface SuiBalance {
  coinType: string
  coinObjectCount: number
  totalBalance: string
  lockedBalance: Record<string, unknown>
}

interface SuiTxBlock {
  digest: string
  timestampMs?: string
  checkpoint?: string
  effects?: {
    status: { status: string }
    gasUsed: { computationCost: string; storageCost: string; storageRebate: string }
    transactionDigest: string
    created?: Array<{ owner: unknown; reference: { objectId: string; digest: string } }>
    mutated?: Array<{ owner: unknown; reference: { objectId: string; digest: string } }>
  }
  transaction?: {
    data: {
      message: {
        kind: string
        sender: string
        gasData: { payment: unknown; owner: string; price: string; budget: string }
        inputs: unknown[]
        transactions: unknown[]
      }
    }
  }
}

interface SuiCheckpoint {
  epoch: string
  sequenceNumber: string
  digest: string
  networkTotalTransactions: string
  previousDigest?: string
  epochRollingGasCostSummary: {
    computationCost: string
    storageCost: string
    storageRebate: string
    nonRefundableStorageFee: string
  }
  timestampMs: string
  transactions: string[]
  checkpointCommitments: unknown[]
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function mistToSui(mist: string | number): string {
  const m = typeof mist === 'string' ? Number(mist) : mist
  return (m / MIST_PER_SUI).toFixed(9).replace(/\.?0+$/, '') || '0'
}

async function rpcCall<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const json = await res.json() as RpcResponse<T>
  if (json.error) {
    throw new Error(`Sui RPC error: ${json.error.message}`)
  }
  return json.result as T
}

function mapTx(raw: SuiTxBlock): Transaction {
  const sender = raw.transaction?.data.message.sender ?? ''
  const success = raw.effects?.status.status === 'success'
  const gasUsed = raw.effects?.gasUsed

  return {
    hash: raw.digest,
    blockNumber: Number(raw.checkpoint ?? 0),
    timestamp: raw.timestampMs
      ? new Date(Number(raw.timestampMs)).toISOString()
      : undefined,
    from: sender,
    to: null, // Sui transactions are complex — no single "to"
    value: '0',
    valueFormatted: '0',
    gasUsed: gasUsed ? (Number(gasUsed.computationCost) + Number(gasUsed.storageCost)).toString() : undefined,
    gasPrice: raw.transaction?.data.message.gasData.price,
    status: (success ? 'success' : 'failed') as TxStatus,
    isContractInteraction: raw.transaction?.data.message.kind === 'ProgrammableTransaction',
    tokenTransfers: [],
  }
}

// ─── Provider ──────────────────────────────────────────────────────────────

class SuiProvider implements BlocexProvider {
  private rpcUrl: string

  constructor(config: ProviderConfig) {
    this.rpcUrl = config.baseUrl ?? DEFAULT_RPC
  }

  name(): string {
    return 'sui'
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

  async getBalance(address: string, chain?: Chain): Promise<Balance> {
    const c = chain ?? 'sui'
    if (c !== 'sui') throw new UnsupportedChainError(c, 'sui')

    const result = await rpcCall<SuiBalance>(this.rpcUrl, 'suix_getBalance', [address])

    return {
      address,
      chain: 'sui',
      balance: result.totalBalance,
      balanceFormatted: mistToSui(result.totalBalance),
      symbol: 'SUI',
    }
  }

  async getTxHistory(address: string, chain?: Chain, options?: TxHistoryOptions): Promise<Transaction[]> {
    const c = chain ?? 'sui'
    if (c !== 'sui') throw new UnsupportedChainError(c, 'sui')

    const limit = clampMaxResults(options?.limit)

    const result = await rpcCall<{ data: SuiTxBlock[]; hasNextPage: boolean; nextCursor?: string }>(
      this.rpcUrl,
      'suix_queryTransactionBlocks',
      [
        { filter: { FromAddress: address } },
        null, // cursor
        limit,
        false, // showEvents
      ],
    )

    if (!result.data?.length) return []

    return result.data.map(mapTx)
  }

  async getTxDetail(hash: string, chain?: Chain): Promise<Transaction> {
    const c = chain ?? 'sui'
    if (c !== 'sui') throw new UnsupportedChainError(c, 'sui')

    const result = await rpcCall<SuiTxBlock>(
      this.rpcUrl,
      'sui_getTransactionBlock',
      [hash, 'full'],
    )

    return mapTx(result)
  }

  async getContractInfo(_address: string, _chain?: Chain): Promise<ContractInfo> {
    throw new UnsupportedChainError('sui', 'sui')
  }

  async getGasData(chain?: Chain): Promise<GasData> {
    const c = chain ?? 'sui'
    if (c !== 'sui') throw new UnsupportedChainError(c, 'sui')

    const price = await rpcCall<string>(this.rpcUrl, 'suix_getReferenceGasPrice', [])

    return {
      chain: 'sui',
      safeGasPrice: price,
      proposedGasPrice: price,
      fastGasPrice: price,
    }
  }

  async getBlockInfo(blockNumber: number, chain?: Chain): Promise<BlockInfo> {
    const c = chain ?? 'sui'
    if (c !== 'sui') throw new UnsupportedChainError(c, 'sui')

    const checkpoint = await rpcCall<SuiCheckpoint>(
      this.rpcUrl,
      'sui_getCheckpoint',
      [blockNumber.toString()],
    )

    return {
      number: Number(checkpoint.sequenceNumber),
      hash: checkpoint.digest,
      parentHash: checkpoint.previousDigest ?? '',
      timestamp: new Date(Number(checkpoint.timestampMs)).toISOString(),
      miner: '',
      gasUsed: checkpoint.epochRollingGasCostSummary.computationCost,
      gasLimit: checkpoint.epochRollingGasCostSummary.storageCost,
      txCount: checkpoint.transactions.length,
    }
  }
}

// ─── Register ──────────────────────────────────────────────────────────────

const factory = (config: ProviderConfig) => new SuiProvider(config)
register('sui', factory, 'https://fullnode.mainnet.sui.io:443')
