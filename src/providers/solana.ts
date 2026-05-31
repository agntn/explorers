/**
 * Solana provider — Solana public RPC
 *
 * Public JSON-RPC, no key needed. Native Solana data:
 * SOL balance, tx history, tx detail, block info, fee estimates.
 *
 * https://solana.com/docs/rpc
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

const DEFAULT_RPC = 'https://api.mainnet-beta.solana.com'
const LAMPORTS_PER_SOL = 1_000_000_000

// ─── Solana RPC types ──────────────────────────────────────────────────────

interface RpcResponse<T> {
  jsonrpc: string
  id: number
  result?: T
  error?: { code: number; message: string }
}

interface SignatureInfo {
  signature: string
  slot: number
  blockTime: number | null
  err: unknown | null
  confirmationStatus: string | null
  memo: string | null
}

interface TransactionDetail {
  slot: number
  transaction: {
    message: {
      accountKeys: Array<{ pubkey: string; signer: boolean; writable: boolean }>
      instructions: Array<{ programId: string; data: string }>
      recentBlockhash: string
    }
    signatures: string[]
  }
  meta: {
    err: unknown | null
    fee: number
    preBalances: number[]
    postBalances: number[]
    innerInstructions: unknown[]
    logMessages: string[]
  } | null
  blockTime: number | null
}

interface BlockInfo_rpc {
  blockhash: string
  previousBlockhash: string
  parentSlot: number
  blockTime: number | null
  transactions: unknown[]
  rewards: unknown[]
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function lamportsToSol(lamports: number): string {
  return (lamports / LAMPORTS_PER_SOL).toFixed(9).replace(/\.?0+$/, '') || '0'
}

async function rpcCall<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const json = await res.json() as RpcResponse<T>
  if (json.error) {
    throw new Error(`Solana RPC error: ${json.error.message}`)
  }
  return json.result as T
}

// ─── Provider ──────────────────────────────────────────────────────────────

class SolanaProvider implements BlocexProvider {
  private rpcUrl: string

  constructor(config: ProviderConfig) {
    this.rpcUrl = config.baseUrl ?? DEFAULT_RPC
  }

  name(): string {
    return 'solana'
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
    const c = chain ?? 'solana'
    if (c !== 'solana') throw new UnsupportedChainError(c, 'solana')

    const result = await rpcCall<{ context: { slot: number }; value: number }>(
      this.rpcUrl, 'getBalance', [address],
    )

    return {
      address,
      chain: 'solana',
      balance: result.value.toString(),
      balanceFormatted: lamportsToSol(result.value),
      symbol: 'SOL',
    }
  }

  async getTxHistory(address: string, chain?: Chain, options?: TxHistoryOptions): Promise<Transaction[]> {
    const c = chain ?? 'solana'
    if (c !== 'solana') throw new UnsupportedChainError(c, 'solana')

    const limit = clampMaxResults(options?.limit)

    const sigs = await rpcCall<SignatureInfo[]>(
      this.rpcUrl, 'getSignaturesForAddress', [
        address,
        { limit },
      ],
    )

    if (!sigs?.length) return []

    return sigs.map(sig => ({
      hash: sig.signature,
      blockNumber: sig.slot,
      timestamp: sig.blockTime
        ? new Date(sig.blockTime * 1000).toISOString()
        : undefined,
      from: '',
      to: null,
      value: '0',
      valueFormatted: '0',
      status: (sig.err ? 'failed' : 'success') as TxStatus,
      isContractInteraction: false,
      tokenTransfers: [],
    }))
  }

  async getTxDetail(hash: string, chain?: Chain): Promise<Transaction> {
    const c = chain ?? 'solana'
    if (c !== 'solana') throw new UnsupportedChainError(c, 'solana')

    const result = await rpcCall<TransactionDetail | null>(
      this.rpcUrl, 'getTransaction', [
        hash,
        { encoding: 'json', maxSupportedTransactionVersion: 0 },
      ],
    )

    if (!result) {
      throw normalizeError(new Error(`Transaction not found: ${hash}`), 'solana')
    }

    const accountKeys = result.transaction.message.accountKeys.map(k => k.pubkey)
    const fee = result.meta?.fee ?? 0
    const preBalances = result.meta?.preBalances ?? []
    const postBalances = result.meta?.postBalances ?? []

    // Calculate net SOL change for first signer (usually the sender)
    const firstSigner = result.transaction.message.accountKeys.find(k => k.signer)
    const signerIdx = firstSigner
      ? accountKeys.indexOf(firstSigner.pubkey)
      : 0
    const netChange = (postBalances[signerIdx] ?? 0) - (preBalances[signerIdx] ?? 0)
    const absChange = Math.abs(netChange + fee) // adjust for fee paid by signer

    return {
      hash: result.transaction.signatures[0] ?? hash,
      blockNumber: result.slot,
      timestamp: result.blockTime
        ? new Date(result.blockTime * 1000).toISOString()
        : undefined,
      from: accountKeys[0] ?? '',
      to: accountKeys[1] ?? null,
      value: absChange.toString(),
      valueFormatted: lamportsToSol(absChange),
      gasUsed: undefined,
      gasPrice: fee.toString(),
      status: (result.meta?.err ? 'failed' : 'success') as TxStatus,
      isContractInteraction: result.transaction.message.instructions.some(
        ix => ix.programId !== '11111111111111111111111111111111' && ix.programId !== 'ComputeBudget111111111111111111111111111111',
      ),
      tokenTransfers: [],
    }
  }

  async getContractInfo(_address: string, _chain?: Chain): Promise<ContractInfo> {
    throw new UnsupportedChainError('solana', 'solana')
  }

  async getGasData(chain?: Chain): Promise<GasData> {
    const c = chain ?? 'solana'
    if (c !== 'solana') throw new UnsupportedChainError(c, 'solana')

    // Get recent prioritization fees
    const fees = await rpcCall<Array<{ slot: number; prioritizationFee: number }>>(
      this.rpcUrl, 'getRecentPrioritizationFees', [],
    )

    const feesOnly = fees.map(f => f.prioritizationFee).filter(f => f > 0)
    feesOnly.sort((a, b) => a - b)

    const median = feesOnly.length > 0
      ? feesOnly[Math.floor(feesOnly.length / 2)]!
      : 0

    return {
      chain: 'solana',
      safeGasPrice: (feesOnly[0] ?? 0).toString(),
      proposedGasPrice: median.toString(),
      fastGasPrice: (feesOnly[feesOnly.length - 1] ?? 0).toString(),
    }
  }

  async getBlockInfo(blockNumber: number, chain?: Chain): Promise<BlockInfo> {
    const c = chain ?? 'solana'
    if (c !== 'solana') throw new UnsupportedChainError(c, 'solana')

    const block = await rpcCall<BlockInfo_rpc>(
      this.rpcUrl, 'getBlock', [
        blockNumber,
        { encoding: 'json', transactionDetails: 'none', rewards: false },
      ],
    )

    return {
      number: blockNumber,
      hash: block.blockhash,
      parentHash: block.previousBlockhash,
      timestamp: block.blockTime
        ? new Date(block.blockTime * 1000).toISOString()
        : '',
      miner: '',
      gasUsed: '0',
      gasLimit: '0',
      txCount: block.transactions.length,
    }
  }
}

// ─── Register ──────────────────────────────────────────────────────────────

const factory = (config: ProviderConfig) => new SolanaProvider(config)
register('solana', factory, 'https://api.mainnet-beta.solana.com')
