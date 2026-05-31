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
  ProviderFactory,
} from './core/types.js'
export {
  CHAIN_SYMBOLS,
  CHAIN_NAMES,
  clampMaxResults,
  formatWei,
  hexToNumber,
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
export { getJSON, getRaw, buildQuery } from './core/client.js'
export { register, create, providers, has, getDefaultURL } from './core/registry.js'
export { resolveProvider } from './core/resolve.js'
