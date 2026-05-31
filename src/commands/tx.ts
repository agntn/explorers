/**
 * Transaction operations — history or detail
 */
import { defineCommand } from 'citty'
import consola from 'consola'
import { resolveProvider } from '../core/resolve.js'
import { create } from '../core/registry.js'
import { normalizeChain } from '../core/types.js'

export default defineCommand({
  meta: {
    name: 'tx',
    description: 'Get transaction history or detail',
  },
  args: {
    target: {
      type: 'positional',
      description: 'Address or tx hash',
      required: true,
    },
    chain: {
      type: 'string',
      alias: 'c',
      description: 'Chain',
      default: 'eth',
    },
    limit: {
      type: 'string',
      alias: 'n',
      description: 'Max results (for history)',
      default: '10',
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
    const target = args.target as string

    try {
      // If target looks like a tx hash (0x + 64 hex), show detail
      if (/^0x[0-9a-fA-F]{64}$/.test(target)) {
        const tx = await provider.getTxDetail(target, chain)
        consola.log(`[${providerName}] Tx ${tx.hash}`)
        consola.log(`  Block: ${tx.blockNumber}`)
        consola.log(`  From: ${tx.from}`)
        consola.log(`  To: ${tx.to ?? 'contract creation'}`)
        consola.log(`  Value: ${tx.valueFormatted}`)
        consola.log(`  Status: ${tx.status}`)
        if (tx.functionName) consola.log(`  Method: ${tx.functionName}`)
        if (tx.tokenTransfers.length > 0) {
          consola.log(`  Token transfers: ${tx.tokenTransfers.length}`)
        }
      }
      else {
        // Address — show history
        const limit = Number.parseInt(args.limit as string, 10)
        if (Number.isNaN(limit)) {
          consola.error('Invalid --limit value')
          process.exit(1)
        }
        const txs = await provider.getTxHistory(target, chain, { limit })
        consola.log(`[${providerName}] ${txs.length} transactions for ${target} on ${chain}`)
        consola.log('')
        for (const tx of txs) {
          const val = tx.valueFormatted !== '0' ? ` ${tx.valueFormatted}` : ''
          consola.log(`  ${tx.hash.slice(0, 18)}…  ${tx.from.slice(0, 10)}… → ${(tx.to ?? '?').slice(0, 10)}…${val}  [${tx.status}]`)
        }
      }
    }
    catch (error) {
      consola.error(`Error: ${error instanceof Error ? error.message : error}`)
      process.exit(1)
    }
  },
})
