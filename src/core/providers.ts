/**
 * Built-in providers for blocex
 */

export const builtinProviders = ['etherscan', 'blockscout', 'blockchair'] as const

export type BuiltinProvider = (typeof builtinProviders)[number]
