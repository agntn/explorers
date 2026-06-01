/**
 * Built-in providers for blocex
 */

export const builtinProviders = ['etherscan', 'blockscout', 'blockchair', 'mempool', 'solana', 'ton', 'tron', 'aptos', 'sui'] as const

export type BuiltinProvider = (typeof builtinProviders)[number]
