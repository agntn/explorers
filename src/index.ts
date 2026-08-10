// Side-effect: register all providers
import "./providers/index.js";

export { version } from "./version.js";
export type {
  Chain,
  TxStatus,
  TokenTransfer,
  Transaction,
  Balance,
  TokenBalance,
  ContractInfo,
  GasData,
  GasUnit,
  BlockInfo,
  ProviderCapabilities,
  TxHistoryOptions,
  TokenBalanceOptions,
  ProviderConfig,
} from "./core/types.js";
export { Provider } from "./core/provider.js";
export type { ProviderConstructor } from "./core/provider.js";
export { clampMaxResults, formatWei, hexToWei, normalizeChain } from "./core/types.js";
export {
  BlocexError,
  HTTPError,
  AuthError,
  RateLimitError,
  NotFoundError,
  UnsupportedChainError,
  UnsupportedOperationError,
  UnknownProviderError,
  normalizeError,
} from "./core/errors.js";
export { isEnsName, isAddress, resolveEns } from "./core/ens.js";
export { getJSON, buildQuery } from "./core/client.js";
export { register, create, providers, has, getDefaultURL } from "./core/registry.js";
export { PROVIDER_DEFAULT_CHAIN, resolveProvider } from "./core/resolve.js";
