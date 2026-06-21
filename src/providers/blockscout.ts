/**
 * Blockscout provider — open-source block explorer
 *
 * No API key needed. Deployed on many chains.
 * REST API v2.
 *
 * Public instances:
 *   - eth.blockscout.com
 *   - base.blockscout.com
 *   - optimism.blockscout.com
 *   - arbitrum.blockscout.com
 *   - gnosis.blockscout.com
 *   - polygon.blockscout.com
 *   - linea.blockscout.com
 *   - scroll.blockscout.com
 *   - zksync.blockscout.com
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
  TokenBalanceOptions,
  GasData,
  BlockInfo,
  TxStatus,
  TokenTransfer,
} from '../core/types.js'
import { getJSON, buildQuery } from '../core/client.js'
import { normalizeError, UnsupportedChainError } from '../core/errors.js'
import { register } from '../core/registry.js'
import { assertSafePathSegment } from '../core/path-safety.js'
import { CHAIN_DATA } from 'chains'
import { formatWei, clampMaxResults } from '../core/types.js'

// ─── Chain → Blockscout instance mapping ───────────────────────────────────

const CHAIN_BASES: Partial<Record<Chain, string>> = {
  eth: 'https://eth.blockscout.com',
  base: 'https://base.blockscout.com',
  arbitrum: 'https://arbitrum.blockscout.com',
  optimism: 'https://optimism.blockscout.com',
  polygon: 'https://polygon.blockscout.com',
  gnosis: 'https://gnosis.blockscout.com',
  linea: 'https://linea.blockscout.com',
  scroll: 'https://scroll.blockscout.com',
  zksync: 'https://zksync.blockscout.com',
  avalanche: 'https://avalanche.blockscout.com',
}

// ─── Blockscout API types ──────────────────────────────────────────────────

interface BlockscoutAddress {
  hash: string
  coin_balance: string
  implementation_address?: string
  is_contract: boolean
  is_verified: boolean
  name?: string
  token?: {
    name: string
    symbol: string
    decimals: string
    type: string
  }
}

interface BlockscoutTx {
  hash: string
  block_number: number
  timestamp: string
  from: { hash: string }
  to: { hash: string } | null
  value: string
  gas_used: string
  gas_price: string
  status: string
  method?: string
  tx_types?: string[]
  token_transfers?: BlockscoutTokenTransfer[]
}

interface BlockscoutTokenTransfer {
  token: {
    address: string
    symbol: string
    name: string
    decimals: string
    type: string
  }
  from: { hash: string }
  to: { hash: string }
  total: { value: string }
  tx_hash: string
  block_number: number
  timestamp: string
}

interface BlockscoutTokenBalance {
  token: {
    address: string
    symbol: string
    name: string
    decimals: string
    type: string
  }
  value: string
  token_id?: string
}

interface BlockscoutContractInfo {
  is_verified: boolean
  is_proxy?: boolean
  implementation_address?: string
  name?: string
  compiler_version?: string
  abi?: Array<Record<string, unknown>>
  source_code?: string
  creation_tx_hash?: string
  deployer?: string
}

interface BlockscoutBlock {
  height: number
  hash: string
  parent_hash: string
  timestamp: string
  miner: { hash: string }
  gas_used: string
  gas_limit: string
  tx_count: number
  base_fee_per_gas?: string
}

interface BlockscoutGasPrice {
  average?: string
  fast?: string
  slow?: string
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function getBase(chain: Chain): string {
  const base = CHAIN_BASES[chain]
  if (!base) throw new UnsupportedChainError(chain, 'blockscout')
  return base
}

function mapTx(raw: BlockscoutTx): Transaction {
  const valueWei = BigInt(raw.value).toString()

  const transfers: TokenTransfer[] = (raw.token_transfers ?? []).map(tt => ({
    contract: tt.token.address,
    symbol: tt.token.symbol,
    name: tt.token.name,
    decimals: Number(tt.token.decimals),
    value: tt.total.value,
    valueFormatted: formatWei(tt.total.value, Number(tt.token.decimals)),
    from: tt.from.hash,
    to: tt.to.hash,
    txHash: tt.tx_hash,
    blockNumber: tt.block_number,
    timestamp: tt.timestamp,
  }))

  return {
    hash: raw.hash,
    blockNumber: raw.block_number,
    timestamp: raw.timestamp,
    from: raw.from.hash,
    to: raw.to?.hash ?? null,
    value: valueWei,
    valueFormatted: formatWei(valueWei),
    gasUsed: raw.gas_used,
    gasPrice: raw.gas_price,
    status: (raw.status === 'ok' ? 'success' : 'failed') as TxStatus,
    methodId: undefined,
    functionName: raw.method,
    isContractInteraction: (raw.tx_types?.includes('contract_call')) ?? false,
    tokenTransfers: transfers,
    raw: raw as unknown as Record<string, unknown>,
  }
}

// ─── Provider ──────────────────────────────────────────────────────────────

class BlockscoutProvider implements BlocexProvider {
  private defaultChain: Chain

  constructor(config: ProviderConfig) {
    this.defaultChain = config.defaultChain ?? 'eth'
  }

  name(): string {
    return 'blockscout'
  }

  capabilities(): ProviderCapabilities {
    return {
      balances: true,
      txHistory: true,
      txDetail: true,
      contractInfo: true,
      tokenBalances: true,
      gasData: true,
      blockInfo: true,
    }
  }

  private base(chain?: Chain): string {
    return getBase(chain ?? this.defaultChain)
  }

  async getBalance(address: string, chain?: Chain): Promise<Balance> {
    const c = chain ?? this.defaultChain
    assertSafePathSegment(address, 'address')
    const url = `${this.base(c)}/api/v2/addresses/${encodeURIComponent(address)}`
    const data = await getJSON<BlockscoutAddress>(url)

    return {
      address,
      chain: c,
      balance: data.coin_balance,
      balanceFormatted: formatWei(data.coin_balance),
      symbol: CHAIN_DATA[c]?.symbol ?? 'ETH',
    }
  }

  async getTxHistory(address: string, chain?: Chain, options?: TxHistoryOptions): Promise<Transaction[]> {
    const c = chain ?? this.defaultChain
    assertSafePathSegment(address, 'address')
    const limit = clampMaxResults(options?.limit)
    const url = `${this.base(c)}/api/v2/addresses/${encodeURIComponent(address)}/transactions`

    const data = await getJSON<{ items: BlockscoutTx[] }>(url)

    if (!data.items?.length) return []
    return data.items.slice(0, limit).map(mapTx)
  }

  async getTxDetail(hash: string, chain?: Chain): Promise<Transaction> {
    const c = chain ?? this.defaultChain
    assertSafePathSegment(hash, 'tx hash')
    const url = `${this.base(c)}/api/v2/transactions/${encodeURIComponent(hash)}`
    const data = await getJSON<BlockscoutTx>(url)
    return mapTx(data)
  }

  async getContractInfo(address: string, chain?: Chain): Promise<ContractInfo> {
    const c = chain ?? this.defaultChain
    assertSafePathSegment(address, 'address')

    // Try verified contract first
    try {
      const url = `${this.base(c)}/api/v2/smart-contracts/${encodeURIComponent(address)}`
      const data = await getJSON<BlockscoutContractInfo>(url)
      const isToken = data.abi?.some(item => {
        if (item.type !== 'function') return false
        const name = item.name as string | undefined
        return name === 'transfer' || name === 'balanceOf' || name === 'totalSupply'
      }) ?? false

      return {
        address,
        isVerified: data.is_verified,
        isProxy: data.is_proxy,
        implementationAddress: data.implementation_address,
        name: data.name,
        compilerVersion: data.compiler_version,
        abi: data.abi ? JSON.stringify(data.abi) : undefined,
        sourceCode: data.source_code,
        isToken,
        creator: data.deployer,
        creationTxHash: data.creation_tx_hash,
      }
    }
    catch {
      // Fallback to address endpoint
      const addrUrl = `${this.base(c)}/api/v2/addresses/${encodeURIComponent(address)}`
      const addr = await getJSON<BlockscoutAddress>(addrUrl)

      return {
        address,
        isVerified: addr.is_verified,
        name: addr.name,
        isToken: addr.token != null,
      }
    }
  }

  async getTokenBalances(address: string, chain?: Chain, options?: TokenBalanceOptions): Promise<TokenBalance[]> {
    const c = chain ?? this.defaultChain
    assertSafePathSegment(address, 'address')
    const url = `${this.base(c)}/api/v2/addresses/${encodeURIComponent(address)}/tokens`
    const data = await getJSON<BlockscoutTokenBalance[]>(url)

    let tokens = data.map(t => ({
      contract: t.token.address,
      symbol: t.token.symbol,
      name: t.token.name,
      decimals: Number(t.token.decimals),
      balance: t.value,
      balanceFormatted: formatWei(t.value, Number(t.token.decimals)),
    }))

    if (options?.nonZeroOnly) {
      tokens = tokens.filter(t => t.balance !== '0')
    }

    return tokens
  }

  async getGasData(chain?: Chain): Promise<GasData> {
    const c = chain ?? this.defaultChain
    const url = `${this.base(c)}/api/v2/stats`
    const data = await getJSON<Record<string, unknown>>(url)

    // Blockscout stats endpoint varies; extract gas data if available
    const gasPrices = data.gas_prices as BlockscoutGasPrice | undefined

    return {
      chain: c,
      safeGasPrice: gasPrices?.slow,
      proposedGasPrice: gasPrices?.average,
      fastGasPrice: gasPrices?.fast,
    }
  }

  async getBlockInfo(blockNumber: number, chain?: Chain): Promise<BlockInfo> {
    const c = chain ?? this.defaultChain
    assertSafePathSegment(String(blockNumber), 'block number')
    const url = `${this.base(c)}/api/v2/blocks/${encodeURIComponent(String(blockNumber))}`
    const data = await getJSON<BlockscoutBlock>(url)

    return {
      number: data.height,
      hash: data.hash,
      parentHash: data.parent_hash,
      timestamp: data.timestamp,
      miner: data.miner.hash,
      gasUsed: data.gas_used,
      gasLimit: data.gas_limit,
      txCount: data.tx_count,
      baseFee: data.base_fee_per_gas,
    }
  }
}

// ─── Register ──────────────────────────────────────────────────────────────

const factory = (config: ProviderConfig) => new BlockscoutProvider(config)
register('blockscout', factory, 'https://eth.blockscout.com')
