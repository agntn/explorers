/**
 * blocex — Unified block explorer provider types
 */

// ─── Domain Models ─────────────────────────────────────────────────────────

/** Chain identifier */
export type Chain =
  | 'eth' | 'base' | 'arbitrum' | 'optimism' | 'polygon' | 'bsc'
  | 'avalanche' | 'fantom' | 'gnosis' | 'linea' | 'zksync' | 'scroll'
  | 'bitcoin' | 'solana'

/** Transaction status */
export type TxStatus = 'success' | 'failed' | 'pending'

/** ERC-20 token transfer */
export interface TokenTransfer {
  /** Token contract address */
  contract: string
  /** Token symbol */
  symbol: string
  /** Token name */
  name?: string
  /** Token decimals */
  decimals: number
  /** Transfer amount (raw, string to avoid float) */
  value: string
  /** Human-readable amount */
  valueFormatted: string
  /** From address */
  from: string
  /** To address */
  to: string
  /** Transaction hash */
  txHash: string
  /** Block number */
  blockNumber: number
  /** Timestamp (ISO) */
  timestamp?: string
}

/** Normalized transaction */
export interface Transaction {
  /** Transaction hash */
  hash: string
  /** Block number */
  blockNumber: number
  /** Timestamp (ISO) */
  timestamp?: string
  /** Sender */
  from: string
  /** Recipient (null for contract creation) */
  to: string | null
  /** Value in wei (string) */
  value: string
  /** Human-readable value in native token */
  valueFormatted: string
  /** Gas used */
  gasUsed?: string
  /** Gas price in wei */
  gasPrice?: string
  /** Transaction status */
  status: TxStatus
  /** Method ID (first 4 bytes of input data) */
  methodId?: string
  /** Function name if decoded */
  functionName?: string
  /** Whether this is a contract interaction */
  isContractInteraction: boolean
  /** Token transfers within this tx */
  tokenTransfers: TokenTransfer[]
  /** Raw provider data */
  raw?: Record<string, unknown>
}

/** Normalized address balance */
export interface Balance {
  /** Address */
  address: string
  /** Chain */
  chain: Chain
  /** Balance in wei (string) */
  balance: string
  /** Human-readable balance */
  balanceFormatted: string
  /** Native token symbol (ETH, BNB, etc.) */
  symbol: string
}

/** ERC-20 token holding for an address */
export interface TokenBalance {
  /** Token contract address */
  contract: string
  /** Token symbol */
  symbol: string
  /** Token name */
  name?: string
  /** Token decimals */
  decimals: number
  /** Balance (raw string) */
  balance: string
  /** Human-readable balance */
  balanceFormatted: string
  /** USD price if available */
  priceUsd?: number
  /** USD value if available */
  valueUsd?: number
}

/** Contract information */
export interface ContractInfo {
  /** Contract address */
  address: string
  /** Whether verified (source code available) */
  isVerified: boolean
  /** Whether it's a proxy contract */
  isProxy?: boolean
  /** Implementation address if proxy */
  implementationAddress?: string
  /** Contract name */
  name?: string
  /** Compiler version */
  compilerVersion?: string
  /** Contract ABI (JSON string) */
  abi?: string
  /** Source code */
  sourceCode?: string
  /** Whether it's a token (ERC-20/721/1155) */
  isToken?: boolean
  /** Token standard if applicable */
  tokenStandard?: 'ERC-20' | 'ERC-721' | 'ERC-1155'
  /** Creator address */
  creator?: string
  /** Creation transaction hash */
  creationTxHash?: string
}

/** Gas price data */
export interface GasData {
  /** Chain */
  chain: Chain
  /** Safe/low gas price in gwei */
  safeGasPrice?: string
  /** Proposed/average gas price in gwei */
  proposedGasPrice?: string
  /** Fast gas price in gwei */
  fastGasPrice?: string
  /** Base fee (EIP-1559) in gwei */
  baseFee?: string
  /** Suggested priority fee in gwei */
  priorityFee?: string
}

/** Block info */
export interface BlockInfo {
  /** Block number */
  number: number
  /** Block hash */
  hash: string
  /** Parent hash */
  parentHash: string
  /** Timestamp (ISO) */
  timestamp: string
  /** Miner/validator address */
  miner: string
  /** Gas used */
  gasUsed: string
  /** Gas limit */
  gasLimit: string
  /** Number of transactions */
  txCount: number
  /** Base fee per gas (EIP-1559) */
  baseFee?: string
}

// ─── Provider Interface ────────────────────────────────────────────────────

/** Capabilities of a block explorer provider */
export interface ProviderCapabilities {
  /** Can get address balances */
  balances: boolean
  /** Can list transaction history */
  txHistory: boolean
  /** Can get single tx detail */
  txDetail: boolean
  /** Can get contract info (ABI, source) */
  contractInfo: boolean
  /** Can get token holdings for address */
  tokenBalances: boolean
  /** Can get gas estimates */
  gasData: boolean
  /** Can get block info */
  blockInfo: boolean
}

/** Options for tx history */
export interface TxHistoryOptions {
  /** Start block (inclusive) */
  startBlock?: number
  /** End block (inclusive) */
  endBlock?: number
  /** Sort order */
  sort?: 'asc' | 'desc'
  /** Max results */
  limit?: number
  /** Page number (1-indexed) */
  page?: number
}

/** Options for token balances */
export interface TokenBalanceOptions {
  /** Only include tokens with non-zero balance */
  nonZeroOnly?: boolean
}

/** The unified block explorer provider interface */
export interface BlocexProvider {
  name(): string
  capabilities(): ProviderCapabilities
  /** Get native token balance for address */
  getBalance(address: string, chain?: Chain): Promise<Balance>
  /** Get transaction history for address */
  getTxHistory(address: string, chain?: Chain, options?: TxHistoryOptions): Promise<Transaction[]>
  /** Get single transaction detail */
  getTxDetail(hash: string, chain?: Chain): Promise<Transaction>
  /** Get contract info (ABI, source, verification status) */
  getContractInfo(address: string, chain?: Chain): Promise<ContractInfo>
  /** Get ERC-20 token holdings for address */
  getTokenBalances?(address: string, chain?: Chain, options?: TokenBalanceOptions): Promise<TokenBalance[]>
  /** Get current gas prices */
  getGasData?(chain?: Chain): Promise<GasData>
  /** Get block info by number */
  getBlockInfo?(blockNumber: number, chain?: Chain): Promise<BlockInfo>
}

// ─── Config & Factory ──────────────────────────────────────────────────────

export interface ProviderConfig {
  /** API key (etherscan, blockchair) */
  apiKey?: string
  /** Custom base URL override */
  baseUrl?: string
  /** Request timeout in ms */
  timeout?: number
  /** Default chain if not specified in calls */
  defaultChain?: Chain
}

export type ProviderFactory = (config: ProviderConfig) => BlocexProvider

// ─── Chain Utilities ───────────────────────────────────────────────────────

/** Native token symbols per chain */
export const CHAIN_SYMBOLS: Record<Chain, string> = {
  eth: 'ETH',
  base: 'ETH',
  arbitrum: 'ETH',
  optimism: 'ETH',
  polygon: 'POL',
  bsc: 'BNB',
  avalanche: 'AVAX',
  fantom: 'FTM',
  gnosis: 'xDAI',
  linea: 'ETH',
  zksync: 'ETH',
  scroll: 'ETH',
  bitcoin: 'BTC',
  solana: 'SOL',
}

/** Chain display names */
export const CHAIN_NAMES: Record<Chain, string> = {
  eth: 'Ethereum',
  base: 'Base',
  arbitrum: 'Arbitrum One',
  optimism: 'Optimism',
  polygon: 'Polygon PoS',
  bsc: 'BNB Chain',
  avalanche: 'Avalanche C-Chain',
  fantom: 'Fantom Opera',
  gnosis: 'Gnosis Chain',
  linea: 'Linea',
  zksync: 'zkSync Era',
  scroll: 'Scroll',
  bitcoin: 'Bitcoin',
  solana: 'Solana',
}

// ─── Utility ───────────────────────────────────────────────────────────────

/** Clamp maxResults to [1, max] */
export function clampMaxResults(limit?: number, max = 100): number {
  if (!limit) return max
  return Math.min(Math.max(1, Math.round(limit)), max)
}

/** Format wei to human-readable token amount */
export function formatWei(wei: string | bigint, decimals = 18): string {
  const w = typeof wei === 'string' ? BigInt(wei) : wei
  const negative = w < 0n
  const abs = negative ? -w : w
  const base = 10n ** BigInt(decimals)
  const intPart = abs / base
  const fracPart = abs % base
  const fracStr = fracPart.toString().padStart(decimals, '0').replace(/0+$/, '')
  const result = fracStr ? `${intPart}.${fracStr}` : `${intPart}`
  return negative ? `-${result}` : result
}

/** Parse hex string to number safely */
export function hexToNumber(hex: string): number {
  if (hex.startsWith('0x')) return Number.parseInt(hex, 16)
  return Number.parseInt(hex, 10)
}

/** Parse hex string to wei string */
export function hexToWei(hex: string): string {
  if (hex.startsWith('0x')) return BigInt(hex).toString()
  return BigInt(hex).toString()
}

/** Normalize chain name from various input forms */
export function normalizeChain(input?: string): Chain {
  if (!input) return 'eth'
  const lower = input.toLowerCase().trim()
  const aliases: Record<string, Chain> = {
    ethereum: 'eth',
    mainnet: 'eth',
    'bnb': 'bsc',
    'bnbchain': 'bsc',
    'binance': 'bsc',
    'matic': 'polygon',
    'arb': 'arbitrum',
    'arb1': 'arbitrum',
    'op': 'optimism',
    'avax': 'avalanche',
    'ftm': 'fantom',
    'btc': 'bitcoin',
    'sol': 'solana',
    'zksync-era': 'zksync',
  }
  if (lower in CHAIN_SYMBOLS) return lower as Chain
  return aliases[lower] ?? 'eth'
}
