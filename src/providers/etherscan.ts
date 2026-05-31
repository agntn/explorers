/**
 * Etherscan-family provider — unified API across all Etherscan-powered explorers
 *
 * Supports: Ethereum, Base, Arbitrum, Optimism, Polygon, BSC, Avalanche,
 * Fantom, Gnosis, Linea, zkSync, Scroll
 *
 * Auth: API key (free tier: 5 req/s, 100K calls/day)
 * Env: ETHERSCAN_API_KEY
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
import { normalizeError, AuthError, UnsupportedChainError } from '../core/errors.js'
import { register } from '../core/registry.js'
import { formatWei, CHAIN_SYMBOLS, clampMaxResults } from '../core/types.js'

// ─── Chain → Etherscan subdomain mapping ───────────────────────────────────

const CHAIN_BASES: Partial<Record<Chain, string>> = {
  eth: 'https://api.etherscan.io',
  base: 'https://api.basescan.org',
  arbitrum: 'https://api.arbiscan.io',
  optimism: 'https://api-optimistic.etherscan.io',
  polygon: 'https://api.polygonscan.com',
  bsc: 'https://api.bscscan.com',
  avalanche: 'https://api.snowtrace.io',
  fantom: 'https://api.ftmscan.com',
  gnosis: 'https://api.gnosisscan.io',
  linea: 'https://api.lineascan.build',
  zksync: 'https://api-era.zksync.network',
  scroll: 'https://api.scrollscan.com',
}

// ─── Etherscan API response types ──────────────────────────────────────────

interface EtherscanResponse<T> {
  status: string
  message: string
  result: T
}

interface EtherscanTx {
  blockNumber: string
  timeStamp: string
  hash: string
  from: string
  to: string
  value: string
  gas: string
  gasUsed: string
  gasPrice: string
  isError: string
  txreceipt_status: string
  input: string
  functionName?: string
  methodId?: string
  contractAddress: string
  confirmations: string
}

interface EtherscanTokenTransfer {
  blockNumber: string
  timeStamp: string
  hash: string
  from: string
  to: string
  value: string
  tokenName: string
  tokenSymbol: string
  tokenDecimal: string
  contractAddress: string
}

interface EtherscanTokenBalance {
  contractAddress: string
  tokenName: string
  tokenSymbol: string
  tokenDecimal: string
  balance: string
}

interface EtherscanGasResult {
  LastBlock: string
  SafeGasPrice: string
  ProposeGasPrice: string
  FastGasPrice: string
  suggestBaseFee: string
  gasUsedRatio: string
}

interface EtherscanBlockResult {
  blockNumber: string
  timeStamp: string
  blockMiner: string
  gasLimit: string
  gasUsed: string
  baseFeePerGas?: string
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function getBase(chain: Chain): string {
  const base = CHAIN_BASES[chain]
  if (!base) throw new UnsupportedChainError(chain, 'etherscan')
  return base
}

function txStatus(isError: string, receiptStatus: string): TxStatus {
  if (isError === '1') return 'failed'
  if (receiptStatus === '0') return 'failed'
  return 'success'
}

function toTimestamp(epoch: string): string {
  return new Date(Number(epoch) * 1000).toISOString()
}

function mapTx(raw: EtherscanTx): Transaction {
  const chain = 'eth' // caller provides chain context
  const valueWei = raw.value
  const transfers: TokenTransfer[] = []

  return {
    hash: raw.hash,
    blockNumber: Number(raw.blockNumber),
    timestamp: toTimestamp(raw.timeStamp),
    from: raw.from,
    to: raw.to || null,
    value: valueWei,
    valueFormatted: formatWei(valueWei),
    gasUsed: raw.gasUsed,
    gasPrice: raw.gasPrice,
    status: txStatus(raw.isError, raw.txreceipt_status),
    methodId: raw.methodId,
    functionName: raw.functionName,
    isContractInteraction: raw.input !== '0x' && raw.input.length > 2,
    tokenTransfers: transfers,
    raw: raw as unknown as Record<string, unknown>,
  }
}

function mapTokenTransfer(raw: EtherscanTokenTransfer): TokenTransfer {
  return {
    contract: raw.contractAddress,
    symbol: raw.tokenSymbol,
    name: raw.tokenName,
    decimals: Number(raw.tokenDecimal),
    value: raw.value,
    valueFormatted: formatWei(raw.value, Number(raw.tokenDecimal)),
    from: raw.from,
    to: raw.to,
    txHash: raw.hash,
    blockNumber: Number(raw.blockNumber),
    timestamp: toTimestamp(raw.timeStamp),
  }
}

// ─── Provider ──────────────────────────────────────────────────────────────

class EtherscanProvider implements BlocexProvider {
  private apiKey: string
  private defaultChain: Chain

  constructor(config: ProviderConfig) {
    const key = config.apiKey ?? process.env.ETHERSCAN_API_KEY ?? ''
    if (!key) {
      throw new AuthError('etherscan', 'Set ETHERSCAN_API_KEY or pass apiKey in config')
    }
    this.apiKey = key
    this.defaultChain = config.defaultChain ?? 'eth'
  }

  name(): string {
    return 'etherscan'
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

  private async api<T>(chain: Chain, module: string, action: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    const base = getBase(chain)
    const query = buildQuery({
      module,
      action,
      apikey: this.apiKey,
      ...params,
    })
    const url = `${base}/api${query}`
    const res = await getJSON<EtherscanResponse<T>>(url)

    if (res.status === '0' && res.message === 'NOTOK') {
      const errMsg = String(res.result)
      if (errMsg.includes('rate limit') || errMsg.includes('Max rate limit')) {
        throw normalizeError(new Error('429 rate limit exceeded'), 'etherscan')
      }
      if (errMsg.includes('Invalid API Key')) {
        throw new AuthError('etherscan', 'Invalid API key')
      }
    }

    return res.result
  }

  async getBalance(address: string, chain?: Chain): Promise<Balance> {
    const c = chain ?? this.defaultChain
    const result = await this.api<string>(c, 'account', 'balance', {
      address,
      tag: 'latest',
    })

    return {
      address,
      chain: c,
      balance: result,
      balanceFormatted: formatWei(result),
      symbol: CHAIN_SYMBOLS[c] ?? 'ETH',
    }
  }

  async getTxHistory(address: string, chain?: Chain, options?: TxHistoryOptions): Promise<Transaction[]> {
    const c = chain ?? this.defaultChain
    const limit = clampMaxResults(options?.limit)
    const result = await this.api<EtherscanTx[]>(c, 'account', 'txlist', {
      address,
      startblock: options?.startBlock ?? 0,
      endblock: options?.endBlock ?? 99999999,
      page: options?.page ?? 1,
      offset: limit,
      sort: options?.sort ?? 'desc',
    })

    if (!Array.isArray(result)) return []
    return result.map(mapTx)
  }

  async getTxDetail(hash: string, chain?: Chain): Promise<Transaction> {
    const c = chain ?? this.defaultChain
    // Etherscan doesn't have a single-tx endpoint; use proxy to get receipt + tx
    const tx = await this.api<Record<string, string>>(c, 'proxy', 'eth_getTransactionByHash', {
      txhash: hash,
    })

    if (!tx || !tx.hash) {
      throw normalizeError(new Error(`Transaction not found: ${hash}`), 'etherscan')
    }

    const receipt = await this.api<Record<string, string>>(c, 'proxy', 'eth_getTransactionReceipt', {
      txhash: hash,
    })

    return {
      hash: tx.hash ?? '',
      blockNumber: Number(tx.blockNumber ?? '0x0'),
      from: tx.from ?? '',
      to: tx.to ?? null,
      value: tx.value ? BigInt(tx.value).toString() : '0',
      valueFormatted: tx.value ? formatWei(BigInt(tx.value).toString()) : '0',
      gasUsed: receipt?.gasUsed ? BigInt(receipt.gasUsed).toString() : undefined,
      gasPrice: tx.gasPrice ? BigInt(tx.gasPrice).toString() : undefined,
      status: receipt?.status === '0x1' ? 'success' : 'failed',
      methodId: tx.input ? tx.input.slice(0, 10) : undefined,
      isContractInteraction: (tx.input?.length ?? 0) > 10,
      tokenTransfers: [],
      raw: { ...tx, receipt } as Record<string, unknown>,
    }
  }

  async getContractInfo(address: string, chain?: Chain): Promise<ContractInfo> {
    const c = chain ?? this.defaultChain

    // Check if verified
    let abi: string | undefined
    let name: string | undefined
    let compilerVersion: string | undefined
    let sourceCode: string | undefined
    let isVerified = false

    try {
      const source = await this.api<Record<string, string>>(c, 'contract', 'getsourcecode', { address })
      if (Array.isArray(source) && source[0]) {
        const s = source[0]
        isVerified = s.ABI !== 'Contract source code not verified'
        abi = isVerified ? s.ABI : undefined
        name = s.ContractName || undefined
        compilerVersion = s.CompilerVersion || undefined
        sourceCode = isVerified ? s.SourceCode : undefined
      }
    }
    catch {
      // Source not available — continue with basic info
    }

    return {
      address,
      isVerified,
      name,
      compilerVersion,
      abi,
      sourceCode,
    }
  }

  async getTokenBalances(address: string, chain?: Chain, options?: TokenBalanceOptions): Promise<TokenBalance[]> {
    const c = chain ?? this.defaultChain
    const result = await this.api<EtherscanTokenBalance[]>(c, 'account', 'tokenlist', {
      address,
    })

    if (!Array.isArray(result)) return []

    let tokens = result.map(t => ({
      contract: t.contractAddress,
      symbol: t.tokenSymbol,
      name: t.tokenName,
      decimals: Number(t.tokenDecimal),
      balance: t.balance,
      balanceFormatted: formatWei(t.balance, Number(t.tokenDecimal)),
    }))

    if (options?.nonZeroOnly) {
      tokens = tokens.filter(t => t.balance !== '0')
    }

    return tokens
  }

  async getGasData(chain?: Chain): Promise<GasData> {
    const c = chain ?? this.defaultChain
    const result = await this.api<EtherscanGasResult>(c, 'gastracker', 'gasoracle')

    return {
      chain: c,
      safeGasPrice: result.SafeGasPrice,
      proposedGasPrice: result.ProposeGasPrice,
      fastGasPrice: result.FastGasPrice,
      baseFee: result.suggestBaseFee,
    }
  }

  async getBlockInfo(blockNumber: number, chain?: Chain): Promise<BlockInfo> {
    const c = chain ?? this.defaultChain
    const result = await this.api<EtherscanBlockResult>(c, 'block', 'getblockreward', {
      blockno: blockNumber,
    })

    return {
      number: Number(result.blockNumber),
      hash: '', // Etherscan block reward endpoint doesn't return hash
      parentHash: '',
      timestamp: toTimestamp(result.timeStamp),
      miner: result.blockMiner,
      gasUsed: result.gasUsed,
      gasLimit: result.gasLimit,
      txCount: 0, // not available from this endpoint
      baseFee: result.baseFeePerGas,
    }
  }
}

// ─── Register ──────────────────────────────────────────────────────────────

const factory = (config: ProviderConfig) => new EtherscanProvider(config)
register('etherscan', factory, 'https://api.etherscan.io')
