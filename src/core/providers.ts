/**
 * Built-in providers for blocex
 */

export const builtinProviders = ['etherscan', 'blockscout', 'blockchair', 'mempool'] as const

export type BuiltinProvider = (typeof builtinProviders)[number]
