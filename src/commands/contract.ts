/**
 * Get contract info (supports ENS)
 */
import { defineCommand } from 'citty'
import consola from 'consola'
import { resolveProvider, PROVIDER_DEFAULT_CHAIN } from '../core/resolve.js'
import { create } from '../core/registry.js'
import { normalizeChain } from '../core/types.js'
import { resolveInput } from '../core/input.js'

export default defineCommand({
  meta: {
    name: 'contract',
    description: 'Get smart contract info (supports ENS)',
  },
  args: {
    address: {
      type: 'positional',
      description: 'Contract address or ENS name',
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

    try {
      const { address } = await resolveInput(args.address as string)
      const info = await provider.getContractInfo(address, chain)
      consola.log(`[${providerName}] Contract ${info.address}`)
      consola.log(`  Verified: ${info.isVerified}`)
      if (info.name) consola.log(`  Name: ${info.name}`)
      if (info.compilerVersion) consola.log(`  Compiler: ${info.compilerVersion}`)
      if (info.isProxy) consola.log(`  Proxy → ${info.implementationAddress}`)
      if (info.isToken) consola.log(`  Token standard: ${info.tokenStandard ?? 'ERC-20 (inferred)'}`)
      if (info.creator) consola.log(`  Creator: ${info.creator}`)
    }
    catch (error) {
      consola.error(`Error: ${error instanceof Error ? error.message : error}`)
      process.exit(1)
    }
  },
})
