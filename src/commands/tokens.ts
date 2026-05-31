/**
 * List ERC-20 token holdings for an address
 */
import { defineCommand } from 'citty'
import consola from 'consola'
import { resolveProvider } from '../core/resolve.js'
import { create } from '../core/registry.js'
import { normalizeChain } from '../core/types.js'

export default defineCommand({
  meta: {
    name: 'tokens',
    description: 'List ERC-20 token holdings for an address',
  },
  args: {
    address: {
      type: 'positional',
      description: 'Blockchain address',
      required: true,
    },
    chain: {
      type: 'string',
      alias: 'c',
      description: 'Chain',
      default: 'eth',
    },
    provider: {
      type: 'string',
      alias: 'p',
      description: 'Provider',
    },
  },
  async run({ args }) {
    const providerName = resolveProvider(args.provider as string | undefined)
    const provider = create(providerName)
    const chain = normalizeChain(args.chain as string)

    const caps = provider.capabilities()
    if (!caps.tokenBalances) {
      consola.error(`Provider "${providerName}" does not support token balances`)
      process.exit(1)
    }

    try {
      const tokens = await provider.getTokenBalances!(args.address as string, chain, { nonZeroOnly: true })
      consola.log(`[${providerName}] ${tokens.length} tokens for ${args.address} on ${chain}`)
      consola.log('')
      for (const t of tokens) {
        const usd = t.valueUsd ? ` ($${t.valueUsd.toFixed(2)})` : ''
        consola.log(`  ${t.symbol}: ${t.balanceFormatted}${usd}  [${t.contract.slice(0, 10)}…]`)
      }
    }
    catch (error) {
      consola.error(`Error: ${error instanceof Error ? error.message : error}`)
      process.exit(1)
    }
  },
})
