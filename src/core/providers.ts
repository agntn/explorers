/**
 * Built-in providers for blocex
 */

export const builtinProviders = ['etherscan', 'blockscout', 'blockchair', 'mempool', 'solana', 'ton', 'tron'] as const

export type BuiltinProvider = (typeof builtinProviders)[number]
