/**
 * Get native token balance for an address (supports ENS)
 */
import { defineCommand } from 'citty'
import consola from 'consola'
import { resolveProvider, PROVIDER_DEFAULT_CHAIN } from '../core/resolve.js'
import { create } from '../core/registry.js'
import { normalizeChain } from '../core/types.js'
import { resolveInput } from '../core/input.js'

export default defineCommand({
  meta: {
    name: 'balance',
    description: 'Get native token balance for an address (supports ENS)',
  },
  args: {
    address: {
      type: 'positional',
      description: 'Blockchain address or ENS name',
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
    const defaultChain = PROVIDER_DEFAULT_CHAIN[providerName] ?? args.chain
    const chain = normalizeChain(defaultChain as string)

    try {
      const { address } = await resolveInput(args.address as string)
      const balance = await provider.getBalance(address, chain)
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
