/**
 * Pi extension: blocex — unified block explorer tools
 */
import type { AgentToolResult, ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Text } from '@earendil-works/pi-tui'
import { Type } from 'typebox'

/** Lazy-load the library (registers all providers on import). */
async function loadLib() {
  const mod = await import('blocex').catch(() => {
    // @ts-ignore — runtime fallback for dev (same package source)
    return import('../../src/index.ts')
  })
  return mod as typeof import('blocex')
}

async function getProvider(preferred?: string) {
  const lib = await loadLib()
  const name = lib.resolveProvider(preferred)
  return { name, provider: lib.create(name) }
}

export default function blocexExtension(pi: ExtensionAPI) {
  // ─── get_balance ─────────────────────────────────────────────────────────
  pi.registerTool({
    name: 'blocex_balance',
    label: 'Blocex Balance',
    description: 'Get native token balance for a blockchain address',
    promptSnippet: 'Use to check ETH, BTC, or other native token balances across chains.',
    promptGuidelines: [
      'Provide a blockchain address and optionally a chain (eth, base, bitcoin, ...)',
      'Default chain is Ethereum mainnet',
      'Returns raw wei and human-readable balance',
    ],
    parameters: Type.Object({
      address: Type.String({ description: 'Blockchain address' }),
      chain: Type.Optional(Type.String({ description: 'Chain (eth, base, arbitrum, bitcoin, solana, ...)', default: 'eth' })),
      provider: Type.Optional(Type.String({ description: 'Provider (etherscan, blockscout, blockchair)' })),
    }),
    renderCall(args, _theme) {
      return new Text(`🔍 Balance: ${args.address} (${args.chain ?? 'eth'})`, 0, 0)
    },
    async execute(_toolCallId, params): Promise<AgentToolResult> {
      const { name, provider } = await getProvider(params.provider)
      const lib = await loadLib()
      const chain = lib.normalizeChain(params.chain)
      const balance = await provider.getBalance(params.address, chain)
      return {
        content: [{
          type: 'text',
          text: `[${name}] ${balance.chain} balance for ${balance.address}: ${balance.balanceFormatted} ${balance.symbol} (${balance.balance} wei)`,
        }],
      }
    },
  })

  // ─── get_tx_history ──────────────────────────────────────────────────────
  pi.registerTool({
    name: 'blocex_tx_history',
    label: 'Blocex Tx History',
    description: 'Get transaction history for a blockchain address',
    promptSnippet: 'Use to list recent transactions for any address.',
    promptGuidelines: [
      'Provide a blockchain address and optionally a chain and limit',
      'Returns normalized tx list with from/to/value/status',
      'Default limit is 10',
    ],
    parameters: Type.Object({
      address: Type.String({ description: 'Blockchain address' }),
      chain: Type.Optional(Type.String({ description: 'Chain', default: 'eth' })),
      limit: Type.Optional(Type.Number({ description: 'Max results', default: 10 })),
      provider: Type.Optional(Type.String({ description: 'Provider' })),
    }),
    renderCall(args, _theme) {
      return new Text(`📜 Tx history: ${args.address} (limit: ${args.limit ?? 10})`, 0, 0)
    },
    async execute(_toolCallId, params): Promise<AgentToolResult> {
      const { name, provider } = await getProvider(params.provider)
      const lib = await loadLib()
      const chain = lib.normalizeChain(params.chain)
      const txs = await provider.getTxHistory(params.address, chain, { limit: params.limit })

      const lines = txs.map(tx =>
        `${tx.hash.slice(0, 14)}… ${tx.from.slice(0, 10)}…→${(tx.to ?? 'new').slice(0, 10)}… ${tx.valueFormatted} [${tx.status}]`,
      )

      return {
        content: [{
          type: 'text',
          text: `[${name}] ${txs.length} transactions on ${chain}:\n${lines.join('\n')}`,
        }],
      }
    },
  })

  // ─── get_tx_detail ───────────────────────────────────────────────────────
  pi.registerTool({
    name: 'blocex_tx_detail',
    label: 'Blocex Tx Detail',
    description: 'Get detailed info about a specific transaction',
    promptSnippet: 'Use to inspect a single transaction by hash.',
    promptGuidelines: [
      'Provide a tx hash (0x...) and optionally a chain',
      'Returns full tx details including gas, status, method, token transfers',
    ],
    parameters: Type.Object({
      hash: Type.String({ description: 'Transaction hash (0x...)' }),
      chain: Type.Optional(Type.String({ description: 'Chain', default: 'eth' })),
      provider: Type.Optional(Type.String({ description: 'Provider' })),
    }),
    renderCall(args, _theme) {
      return new Text(`🔬 Tx detail: ${args.hash.slice(0, 18)}…`, 0, 0)
    },
    async execute(_toolCallId, params): Promise<AgentToolResult> {
      const { name, provider } = await getProvider(params.provider)
      const lib = await loadLib()
      const chain = lib.normalizeChain(params.chain)
      const tx = await provider.getTxDetail(params.hash, chain)

      const parts = [
        `[${name}] Tx ${tx.hash}`,
        `Block: ${tx.blockNumber} | Status: ${tx.status}`,
        `From: ${tx.from}`,
        `To: ${tx.to ?? 'contract creation'}`,
        `Value: ${tx.valueFormatted}`,
        tx.functionName ? `Method: ${tx.functionName}` : null,
        tx.tokenTransfers.length > 0 ? `Token transfers: ${tx.tokenTransfers.length}` : null,
      ].filter(Boolean)

      return {
        content: [{ type: 'text', text: parts.join('\n') }],
      }
    },
  })

  // ─── get_contract_info ───────────────────────────────────────────────────
  pi.registerTool({
    name: 'blocex_contract',
    label: 'Blocex Contract',
    description: 'Get smart contract info — verification, ABI, source, proxy status',
    promptSnippet: 'Use to check if a contract is verified, get its ABI, or detect proxies.',
    promptGuidelines: [
      'Provide a contract address and optionally a chain',
      'Returns verification status, name, compiler, ABI (if verified), proxy info',
    ],
    parameters: Type.Object({
      address: Type.String({ description: 'Contract address' }),
      chain: Type.Optional(Type.String({ description: 'Chain', default: 'eth' })),
      provider: Type.Optional(Type.String({ description: 'Provider' })),
    }),
    renderCall(args, _theme) {
      return new Text(`📋 Contract: ${args.address}`, 0, 0)
    },
    async execute(_toolCallId, params): Promise<AgentToolResult> {
      const { name, provider } = await getProvider(params.provider)
      const lib = await loadLib()
      const chain = lib.normalizeChain(params.chain)
      const info = await provider.getContractInfo(params.address, chain)

      const parts = [
        `[${name}] Contract ${info.address}`,
        `Verified: ${info.isVerified}`,
        info.name ? `Name: ${info.name}` : null,
        info.compilerVersion ? `Compiler: ${info.compilerVersion}` : null,
        info.isProxy ? `Proxy → ${info.implementationAddress}` : null,
        info.isToken ? 'Is token: yes' : null,
        info.creator ? `Creator: ${info.creator}` : null,
      ].filter(Boolean)

      return {
        content: [{ type: 'text', text: parts.join('\n') }],
      }
    },
  })

  // ─── get_gas ─────────────────────────────────────────────────────────────
  pi.registerTool({
    name: 'blocex_gas',
    label: 'Blocex Gas',
    description: 'Get current gas prices for a chain',
    promptSnippet: 'Use to check gas prices before sending a transaction.',
    promptGuidelines: [
      'Provide a chain (default: eth)',
      'Returns safe/average/fast gas prices in gwei',
    ],
    parameters: Type.Object({
      chain: Type.Optional(Type.String({ description: 'Chain', default: 'eth' })),
      provider: Type.Optional(Type.String({ description: 'Provider' })),
    }),
    renderCall(args, _theme) {
      return new Text(`⛽ Gas prices: ${args.chain ?? 'eth'}`, 0, 0)
    },
    async execute(_toolCallId, params): Promise<AgentToolResult> {
      const { name, provider } = await getProvider(params.provider)
      const lib = await loadLib()
      const chain = lib.normalizeChain(params.chain)

      const caps = provider.capabilities()
      if (!caps.gasData) {
        return { content: [{ type: 'text', text: `Provider "${name}" does not support gas data` }] }
      }

      const gas = await provider.getGasData!(chain)
      const parts = [
        `[${name}] Gas on ${gas.chain}:`,
        gas.safeGasPrice ? `  Safe: ${gas.safeGasPrice} gwei` : null,
        gas.proposedGasPrice ? `  Average: ${gas.proposedGasPrice} gwei` : null,
        gas.fastGasPrice ? `  Fast: ${gas.fastGasPrice} gwei` : null,
        gas.baseFee ? `  Base fee: ${gas.baseFee} gwei` : null,
      ].filter(Boolean)

      return {
        content: [{ type: 'text', text: parts.join('\n') }],
      }
    },
  })

  // ─── providers ───────────────────────────────────────────────────────────
  pi.registerTool({
    name: 'blocex_providers',
    label: 'Blocex Providers',
    description: 'List registered block explorer providers and their capabilities',
    promptSnippet: 'Use to check which block explorer providers are available.',
    promptGuidelines: ['Returns provider names and their capability flags.'],
    parameters: Type.Object({}),
    renderCall(_args, _theme) {
      return new Text('🔍 List blocex providers', 0, 0)
    },
    async execute(): Promise<AgentToolResult> {
      const lib = await loadLib()
      const names = lib.providers()

      const lines = names.map((name) => {
        const provider = lib.create(name)
        const caps = provider.capabilities()
        const active = Object.entries(caps).filter(([, v]) => v).map(([k]) => k)
        return `  ${name}: ${active.join(', ')}`
      })

      return {
        content: [{
          type: 'text',
          text: `Registered providers (${names.length}):\n${lines.join('\n')}`,
        }],
      }
    },
  })
}
