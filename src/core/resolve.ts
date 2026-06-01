/**
 * Auto-select provider by checking env vars
 */

import { providers, has } from './registry.js'
import { UnknownProviderError } from './errors.js'

const ENV_MAP: Record<string, string[]> = {
  etherscan: ['ETHERSCAN_API_KEY'],
  blockscout: [],
  blockchair: ['BLOCKCHAIR_API_KEY'],
  mempool: [],
  solana: [],
  ton: [],
  tron: [],
}

/** Provider-specific default chains */
export const PROVIDER_DEFAULT_CHAIN: Record<string, string> = {
  mempool: 'bitcoin',
  solana: 'solana',
  ton: 'ton',
  tron: 'tron',
}

/**
 * Resolve the best available provider.
 * 1. If preferred is given and registered, use it
 * 2. Otherwise, pick first provider whose env keys are set
 * 3. Fall back to 'blockscout' (always available — no API key needed)
 */
export function resolveProvider(preferred?: string): string {
  if (preferred) {
    if (!has(preferred)) {
      throw new UnknownProviderError(preferred)
    }
    return preferred
  }

  // Pick first provider whose env keys are all set
  for (const [name, envKeys] of Object.entries(ENV_MAP)) {
    if (!has(name)) continue
    if (envKeys.length === 0) continue
    const allSet = envKeys.every(k => process.env[k])
    if (allSet) return name
  }

  // Default: blockscout (no key needed)
  if (has('blockscout')) return 'blockscout'

  return providers()[0] ?? 'blockscout'
}
