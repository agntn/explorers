/**
 * Address/input resolution — ENS names, raw addresses, tx hashes.
 */
import consola from 'consola'
import { isEnsName, isAddress, resolveEns } from './ens.js'

export type InputType = 'address' | 'txhash' | 'ens'

/** Classify raw user input */
export function classifyInput(input: string): InputType {
  const trimmed = input.trim()
  if (/^0x[0-9a-fA-F]{64}$/.test(trimmed)) return 'txhash'
  if (isEnsName(trimmed)) return 'ens'
  if (isAddress(trimmed)) return 'address'
  // Assume it's an address-like input
  return 'address'
}

/**
 * Resolve user input to an Ethereum address.
 * - ENS name → resolve via public RPC
 * - 0x address → pass through
 * Returns the resolved address or exits with error.
 */
export async function resolveInput(input: string): Promise<{ address: string; type: InputType }> {
  const trimmed = input.trim()
  const type = classifyInput(trimmed)

  if (type === 'txhash') {
    return { address: trimmed, type }
  }

  if (type === 'address') {
    return { address: trimmed, type }
  }

  // ENS resolution
  consola.info(`Resolving ENS name: ${trimmed}`)
  const resolved = await resolveEns(trimmed)
  if (!resolved) {
    consola.error(`Could not resolve ENS name: ${trimmed}`)
    process.exit(1)
  }
  consola.log(`  → ${resolved}`)
  return { address: resolved, type }
}
