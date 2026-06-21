// Side-effect: register all providers
import './providers/index.js'

export { version } from './version.js'
export type {
  Chain,
  TxStatus,
  TokenTransfer,
  Transaction,
  Balance,
  TokenBalance,
  ContractInfo,
  GasData,
  BlockInfo,
  ProviderCapabilities,
  TxHistoryOptions,
  TokenBalanceOptions,
  BlocexProvider,
  ProviderConfig,
} from './core/types.js'
export {
  // CHAIN_SYMBOLS and CHAIN_NAMES removed — use CHAIN_DATA from chains
  clampMaxResults,
  formatWei,
  hexToWei,
  normalizeChain,
} from './core/types.js'
export type {
  BlocexError,
  HTTPError,
  AuthError,
  RateLimitError,
  NotFoundError,
  UnsupportedChainError,
  UnknownProviderError,
} from './core/errors.js'
export {
  normalizeError,
} from './core/errors.js'
export { isEnsName, isAddress, resolveEns } from './core/ens.js'
export { getJSON, buildQuery } from './core/client.js'
export { register, create, providers, has, getDefaultURL } from './core/registry.js'
export { resolveProvider } from './core/resolve.js'
