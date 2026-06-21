/**
 * Blockchair provider — multi-chain block explorer
 *
 * Supports: Bitcoin, Ethereum, and 10+ chains.
 * Free tier: limited requests, dashboard queries.
 * Auth: optional BLOCKCHAIR_API_KEY for higher limits.
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
  TokenBalance,
  GasData,
  BlockInfo,
  TxStatus,
  TokenTransfer,
} from '../core/types.js'
import { getJSON, buildQuery } from '../core/client.js'
import { normalizeError, UnsupportedChainError } from '../core/errors.js'
import { register } from '../core/registry.js'
import { CHAIN_DATA } from 'chains'
import { formatWei, clampMaxResults } from '../core/types.js'
import { decimalToWei } from '../core/wei.js'
import { assertSafePathSegment } from '../core/path-safety.js'

// ─── Chain → Blockchair chain name ─────────────────────────────────────────

const CHAIN_NAMES: Partial<Record<Chain, string>> = {
  bitcoin: 'bitcoin',
  eth: 'ethereum',
  base: 'base',
  arbitrum: 'arbitrum',
  optimism: 'optimism',
  polygon: 'polygon',
  bsc: 'bnb',
  avalanche: 'avalanche',
  gnosis: 'gnosis',
}

// ─── Blockchair API types ──────────────────────────────────────────────────

interface BlockchairResponse<T> {
  data: T
  context: {
    code: number
    error?: string
    limit?: string
    offset?: string
  }
}

interface BlockchairAddressData {
  address: {
    type: string
    address: string
    balance: number
    balance_usd?: number
    received: number
    spent: number
    unspent_output_count: number
    first_seen_receiving?: string
    last_seen_receiving?: string
    transaction_count: number
    output_count: number
    // ETH-specific
    call_count?: number
    type_is_contract?: boolean
  }
  transactions?: string[]
  utxo?: Array<{
    block_id: number
    transaction_hash: string
    index: number
    value: number
  }>
}

interface BlockchairTxData {
  transaction: {
    hash: string
    block_id: number
    time: string
    size: number
    weight?: number
    version: number
    lock_time: number
    is_coinbase: boolean
    input_count: number
    output_count: number
    input_total: number
    output_total: number
    fee: number
    // ETH-specific
    from?: string
    to?: string
    value?: number
    gas?: number
    gas_used?: number
    gas_price?: number
    status?: string
    nonce?: number
    input_data?: string
  }
}

interface BlockchairDashboardsBlocks {
  blocks: Array<{
    id: number
    hash: string
    parent_hash: string
    time: string
    miner?: string
    size: number
    weight?: number
    version: number
    merkle_root: string
    bits: string
    nonce: number
    tx_count: number
    // ETH-specific
    gas_used?: number
    gas_limit?: number
    base_fee_per_gas?: number
    difficulty?: string
    reward?: number
  }>
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function chainName(chain: Chain): string {
  const name = CHAIN_NAMES[chain]
  if (!name) throw new UnsupportedChainError(chain, 'blockchair')
  return name
}

// ─── Provider ──────────────────────────────────────────────────────────────

class BlockchairProvider implements BlocexProvider {
  private apiKey: string | undefined
  private defaultChain: Chain

  constructor(config: ProviderConfig) {
    this.apiKey = config.apiKey ?? process.env.BLOCKCHAIR_API_KEY
    this.defaultChain = config.defaultChain ?? 'eth'
  }

  name(): string {
    return 'blockchair'
  }

  capabilities(): ProviderCapabilities {
    return {
      balances: true,
      txHistory: true,
      txDetail: true,
      contractInfo: false,
      tokenBalances: false,
      gasData: false,
      blockInfo: true,
    }
  }

  private buildUrl(chain: Chain, path: string, params: Record<string, string | number | undefined> = {}): string {
    const cn = chainName(chain)
    const base = `https://api.blockchair.com/${cn}`
    const query = buildQuery({
      key: this.apiKey,
      ...params,
    })
    return `${base}${path}${query}`
  }

  async getBalance(address: string, chain?: Chain): Promise<Balance> {
    const c = chain ?? this.defaultChain
    assertSafePathSegment(address, 'address')
    const url = this.buildUrl(c, `/dashboards/address/${encodeURIComponent(address)}`)
    const res = await getJSON<BlockchairResponse<Record<string, BlockchairAddressData>>>(url)

    const key = Object.keys(res.data)[0]
    if (!key) throw normalizeError(new Error(`Address not found: ${address}`), 'blockchair')
    const data = res.data[key]
    if (!data) throw normalizeError(new Error(`Address data missing: ${address}`), 'blockchair')

    return {
      address,
      chain: c,
      balance: BigInt(data.address.balance).toString(),
      balanceFormatted: formatWei(BigInt(data.address.balance).toString()),
      symbol: CHAIN_DATA[c]?.symbol ?? 'ETH',
    }
  }

  async getTxHistory(address: string, chain?: Chain, options?: TxHistoryOptions): Promise<Transaction[]> {
    const c = chain ?? this.defaultChain
    assertSafePathSegment(address, 'address')
    const limit = clampMaxResults(options?.limit)
    const url = this.buildUrl(c, `/dashboards/address/${encodeURIComponent(address)}`, {
      limit,
    })
    const res = await getJSON<BlockchairResponse<Record<string, BlockchairAddressData>>>(url)

    const key = Object.keys(res.data)[0]
    if (!key) return []
    const addrData = res.data[key]
    if (!addrData) return []

    if (!addrData.transactions?.length) return []

    // Blockchair returns tx hashes for address; fetch details for each.
    // Cap at limit to bound N+1 calls; errors are isolated per-hash so a
    // single bad hash doesn't drop the whole page.
    const txHashes = addrData.transactions.slice(0, limit)
    const txs: Transaction[] = []

    for (const hash of txHashes) {
      try {
        txs.push(await this.getTxDetail(hash, c))
      }
      catch {
        // Skip failed fetches — addrData.transactions could contain
        // unindexed hashes for chains Blockchair hasn't propagated.
      }
    }

    return txs
  }

  async getTxDetail(hash: string, chain?: Chain): Promise<Transaction> {
    const c = chain ?? this.defaultChain
    assertSafePathSegment(hash, 'tx hash')
    const url = this.buildUrl(c, `/dashboards/transaction/${encodeURIComponent(hash)}`)
    const res = await getJSON<BlockchairResponse<Record<string, BlockchairTxData>>>(url)

    const key = Object.keys(res.data)[0]
    if (!key) throw normalizeError(new Error(`Transaction not found: ${hash}`), 'blockchair')
    const entry = res.data[key]
    if (!entry) throw normalizeError(new Error(`Transaction data missing: ${hash}`), 'blockchair')
    const data = entry.transaction

    // Blockchair returns values in the native unit (ETH, BNB, BTC, ...).
    // For BTC we get satoshis as a number; for EVM chains we get a number
    // in ETH (already a float). Multiply by 1e18 via string to preserve
    // precision — `number * 1e18` overflows safe-integer range above ~9 ETH.
    // If `data.value` is missing we fall back to `output_total` for BTC.
    const isEth = c !== 'bitcoin'
    const valueStr = isEth
      ? data.value
        ? BigInt(decimalToWei(data.value)).toString()
        : '0'
      : BigInt(Math.round(data.output_total)).toString()

    return {
      hash: data.hash,
      blockNumber: data.block_id,
      timestamp: data.time,
      from: data.from ?? '',
      to: data.to ?? null,
      value: valueStr,
      valueFormatted: formatWei(valueStr),
      gasUsed: data.gas_used?.toString(),
      gasPrice: data.gas_price?.toString(),
      status: (data.status === 'ok' ? 'success' : data.status === 'fail' ? 'failed' : 'success') as TxStatus,
      isContractInteraction: (data.input_data?.length ?? 0) > 10,
      tokenTransfers: [],
      raw: data as unknown as Record<string, unknown>,
    }
  }

  async getContractInfo(address: string, chain?: Chain): Promise<ContractInfo> {
    const c = chain ?? this.defaultChain
    assertSafePathSegment(address, 'address')
    const url = this.buildUrl(c, `/dashboards/address/${encodeURIComponent(address)}`)
    const res = await getJSON<BlockchairResponse<Record<string, BlockchairAddressData>>>(url)

    const key = Object.keys(res.data)[0]
    if (!key) throw normalizeError(new Error(`Address not found: ${address}`), 'blockchair')
    const data = res.data[key]
    if (!data) throw normalizeError(new Error(`Address data missing: ${address}`), 'blockchair')

    return {
      address,
      isVerified: false, // Blockchair doesn't provide source verification
      isToken: false,
    }
  }

  async getBlockInfo(blockNumber: number, chain?: Chain): Promise<BlockInfo> {
    const c = chain ?? this.defaultChain
    assertSafePathSegment(String(blockNumber), 'block number')
    const url = this.buildUrl(c, `/dashboards/blocks/${encodeURIComponent(String(blockNumber))}`)
    const res = await getJSON<BlockchairResponse<BlockchairDashboardsBlocks>>(url)

    const block = res.data.blocks[0]
    if (!block) throw normalizeError(new Error(`Block not found: ${blockNumber}`), 'blockchair')

    return {
      number: block.id,
      hash: block.hash,
      parentHash: block.parent_hash,
      timestamp: block.time,
      miner: block.miner ?? '',
      gasUsed: (block.gas_used ?? 0).toString(),
      gasLimit: (block.gas_limit ?? 0).toString(),
      txCount: block.tx_count,
      baseFee: block.base_fee_per_gas?.toString(),
    }
  }
}

// ─── Register ──────────────────────────────────────────────────────────────

const factory = (config: ProviderConfig) => new BlockchairProvider(config)
register('blockchair', factory, 'https://api.blockchair.com')
