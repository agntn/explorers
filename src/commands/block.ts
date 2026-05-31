/**
 * Get block info by number
 */
import { defineCommand } from 'citty'
import consola from 'consola'
import { resolveProvider, PROVIDER_DEFAULT_CHAIN } from '../core/resolve.js'
import { create } from '../core/registry.js'
import { normalizeChain } from '../core/types.js'

export default defineCommand({
  meta: {
    name: 'block',
    description: 'Get block info by number',
  },
  args: {
    number: {
      type: 'positional',
      description: 'Block number',
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
    const defaultChain = PROVIDER_DEFAULT_CHAIN[providerName] ?? args.chain
    const chain = normalizeChain(defaultChain as string)
    const blockNum = Number.parseInt(args.number as string, 10)

    if (Number.isNaN(blockNum)) {
      consola.error('Invalid block number')
      process.exit(1)
    }

    const caps = provider.capabilities()
    if (!caps.blockInfo) {
      consola.error(`Provider "${providerName}" does not support block info`)
      process.exit(1)
    }

    try {
      const block = await provider.getBlockInfo!(blockNum, chain)
      consola.log(`[${providerName}] Block #${block.number}`)
      consola.log(`  Hash: ${block.hash}`)
      consola.log(`  Timestamp: ${block.timestamp}`)
      consola.log(`  Miner: ${block.miner}`)
      consola.log(`  Gas used/limit: ${block.gasUsed} / ${block.gasLimit}`)
      consola.log(`  Transactions: ${block.txCount}`)
      if (block.baseFee) consola.log(`  Base fee: ${block.baseFee} gwei`)
    }
    catch (error) {
      consola.error(`Error: ${error instanceof Error ? error.message : error}`)
      process.exit(1)
    }
  },
})
