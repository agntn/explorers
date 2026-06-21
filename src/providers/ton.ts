/**
 * TON provider — The Open Network (Telegram blockchain)
 *
 * Public API via tonapi.io, no key needed.
 * TON balance, tx history, tx detail, block info.
 *
 * https://tonapi.io/api-docs
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
import { getJSON } from '../core/client.js'
import { normalizeError, UnsupportedChainError, NotFoundError } from '../core/errors.js'
import { register } from '../core/registry.js'
import { clampMaxResults } from '../core/types.js'

import { assertSafePathSegment } from '../core/path-safety.js'
const DEFAULT_BASE = 'https://tonapi.io'
const NANOTON = 1_000_000_000

// ─── TON API types ─────────────────────────────────────────────────────────

interface TonAccount {
  address: string
  balance: number
  status: string
  last_activity: number
  name?: string
  is_scam?: boolean
  interfaces?: string[]
}

interface TonEvent {
  event_id: string
  timestamp: number
  actions: Array<{
    type: string
    TonTransfer?: {
      sender: { address: string }
      recipient: { address: string }
      amount: number
      comment?: string
    }
    JettonTransfer?: {
      sender: { address: string }
      recipient: { address: string }
      senders_wallet: string
      recipients_wallet: string
      amount: string
      jetton: { address: string; name: string; symbol: string; decimals: number }
    }
    status: string
  }>
  involved: Record<string, unknown>
}

interface TonBlock {
  workchain: number
  shard: string
  seqno: number
  root_hash: string
  file_hash: string
  global_id: number
  version: number
  after_merge: boolean
  before_split: boolean
  after_split: boolean
  want_merge: boolean
  want_split: boolean
  key_block: boolean
  gen_utime: number
  gen_catchain_seqno: number
  gen_validator_list_hash_short: number
  gen_software_version: number
  master_ref_seqno?: number
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function nanotonToTon(nanotons: number): string {
  return (nanotons / NANOTON).toFixed(9).replace(/\.?0+$/, '') || '0'
}

function mapEventToTx(event: TonEvent): Transaction {
  const firstAction = event.actions[0]
  let from = ''
  let to: string | null = null
  let value = 0

  if (firstAction?.TonTransfer) {
    from = firstAction.TonTransfer.sender.address
    to = firstAction.TonTransfer.recipient.address
    value = firstAction.TonTransfer.amount
  }

  return {
    hash: event.event_id,
    blockNumber: 0,
    timestamp: new Date(event.timestamp * 1000).toISOString(),
    from,
    to,
    value: value.toString(),
    valueFormatted: nanotonToTon(value),
    status: (firstAction?.status === 'ok' ? 'success' : 'failed') as TxStatus,
    isContractInteraction: firstAction?.type !== 'TonTransfer',
    tokenTransfers: [],
  }
}

// ─── Provider ──────────────────────────────────────────────────────────────

class TonProvider implements BlocexProvider {
  private baseUrl: string

  constructor(config: ProviderConfig) {
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE
  }

  name(): string {
    return 'ton'
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
    const c = chain ?? 'ton'
    if (c !== 'ton') throw new UnsupportedChainError(c, 'ton')

    assertSafePathSegment(address, 'address')
    const data = await getJSON<TonAccount>(`${this.baseUrl}/v2/accounts/${encodeURIComponent(address)}`)

    return {
      address,
      chain: 'ton',
      balance: data.balance.toString(),
      balanceFormatted: nanotonToTon(data.balance),
      symbol: 'TON',
    }
  }

  async getTxHistory(address: string, chain?: Chain, options?: TxHistoryOptions): Promise<Transaction[]> {
    const c = chain ?? 'ton'
    if (c !== 'ton') throw new UnsupportedChainError(c, 'ton')
    const limit = clampMaxResults(options?.limit)

    assertSafePathSegment(address, 'address')
    const data = await getJSON<{ events: TonEvent[] }>(
      `${this.baseUrl}/v2/accounts/${encodeURIComponent(address)}/events?limit=${limit}`,
    )

    if (!data.events?.length) return []

    return data.events.map(mapEventToTx)
  }

  async getTxDetail(_hash: string, _chain?: Chain): Promise<Transaction> {
    throw normalizeError(new Error('TON tx detail not yet supported — use tx history'), 'ton')
  }

  async getContractInfo(_address: string, _chain?: Chain): Promise<ContractInfo> {
    throw new UnsupportedChainError('ton', 'ton')
  }

  async getBlockInfo(_blockNumber: number, _chain?: Chain): Promise<BlockInfo> {
    // TonAPI's `/v2/blockchain/blocks` endpoint takes workchain + shard + seqno
    // as path segments, not as query params, and requires signed-int64 workchain
    // IDs. The previous query-string shape always returned 404 even for valid
    // masterchain blocks (verified 2026-06-21). Throw NotFoundError so callers
    // surface a clear error rather than silently rendering `undefined`.
    // Use https://tonscan.org or toncenter.com to fetch TON blocks.
    throw new NotFoundError('TON block (TonAPI blocks endpoint unavailable)', 'ton')
  }
}

// ─── Register ──────────────────────────────────────────────────────────────

const factory = (config: ProviderConfig) => new TonProvider(config)
register('ton', factory, 'https://tonapi.io')
