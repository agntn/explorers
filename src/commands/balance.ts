/**
 * Get native token balance for an address
 */
import { defineCommand } from 'citty'
import consola from 'consola'
import { resolveProvider } from '../core/resolve.js'
import { create } from '../core/registry.js'
import { normalizeChain } from '../core/types.js'

export default defineCommand({
  meta: {
    name: 'balance',
    description: 'Get native token balance for an address',
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
      description: 'Chain (eth, base, arbitrum, bitcoin, ...)',
      default: 'eth',
    },
    provider: {
      type: 'string',
      alias: 'p',
      description: 'Provider (etherscan, blockscout, blockchair)',
    },
  },
  async run({ args }) {
    const providerName = resolveProvider(args.provider as string | undefined)
    const provider = create(providerName)
    const chain = normalizeChain(args.chain as string)

    try {
      const balance = await provider.getBalance(args.address as string, chain)
      consola.log(`[${providerName}] ${balance.chain} balance for ${balance.address}`)
      consola.log(`  ${balance.balanceFormatted} ${balance.symbol}`)
      consola.log(`  Raw: ${balance.balance} wei`)
    }
    catch (error) {
      consola.error(`Error: ${error instanceof Error ? error.message : error}`)
      process.exit(1)
    }
  },
})
