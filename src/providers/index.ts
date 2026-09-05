/** Built-in providers: registry metadata plus a loader for the implementation */

import type { ProviderCapability, ProviderEntry } from "../core/provider.js";
import { ARWEAVE_GATEWAY_URL } from "../core/endpoints.js";

type BuiltinProviderEntry = ProviderEntry & {
  capabilities: readonly ProviderCapability[];
};

/**
 * Every provider shipped with the package, in registration order.
 *
 * A provider missing here is invisible to `create()`. `test/unit/registry.test.ts` compares each
 * entry against the class it loads, so metadata cannot drift away from the implementation.
 */
export const builtins: readonly ProviderEntry[] = [
  {
    key: "etherscan",
    chains: [
      "ethereum",
      "base",
      "arbitrum",
      "optimism",
      "polygon",
      "bsc",
      "avalanche",
      "gnosis",
      "linea",
      "berachain",
    ],
    capabilities: [
      "balances",
      "txHistory",
      "txDetail",
      "contractInfo",
      "tokenBalances",
      "tokenTransfers",
      "gasData",
      "blockInfo",
    ],
    defaultURL: "https://api.etherscan.io/v2/api",
    load: () => import("./etherscan.js").then((m) => m.Etherscan),
  },
  {
    key: "blockscout",
    chains: [
      "ethereum",
      "base",
      "arbitrum",
      "optimism",
      "polygon",
      "gnosis",
      "linea",
      "scroll",
      "zksync",
      "avalanche",
    ],
    capabilities: [
      "balances",
      "txHistory",
      "txDetail",
      "contractInfo",
      "tokenBalances",
      "tokenTransfers",
      "gasData",
      "blockInfo",
    ],
    defaultURL: "https://eth.blockscout.com",
    load: () => import("./blockscout.js").then((m) => m.Blockscout),
  },
  {
    key: "blockchair",
    chains: ["bitcoin", "ethereum", "ecash"],
    capabilities: ["balances", "txHistory", "txDetail", "blockInfo"],
    defaultURL: "https://api.blockchair.com",
    load: () => import("./blockchair.js").then((m) => m.Blockchair),
  },
  {
    key: "mempool",
    chains: ["bitcoin", "litecoin", "pepecoin"],
    capabilities: ["balances", "txHistory", "txDetail", "gasData", "blockInfo"],
    defaultURL: "https://mempool.space",
    load: () => import("./mempool.js").then((m) => m.Mempool),
  },
  {
    key: "blockstream",
    chains: ["bitcoin"],
    capabilities: ["balances", "txHistory", "txDetail", "blockInfo"],
    defaultURL: "https://blockstream.info",
    load: () => import("./blockstream.js").then((m) => m.Blockstream),
  },
  {
    key: "solscan",
    chains: ["solana"],
    capabilities: ["balances", "txHistory", "txDetail", "blockInfo"],
    defaultURL: "https://pro-api.solscan.io/v2.0",
    load: () => import("./solscan.js").then((m) => m.Solscan),
  },
  {
    key: "helius",
    chains: ["solana"],
    capabilities: ["txHistory", "txDetail", "tokenBalances"],
    defaultURL: "https://mainnet.helius-rpc.com",
    load: () => import("./helius.js").then((m) => m.Helius),
  },
  {
    key: "ton",
    chains: ["ton"],
    capabilities: ["balances", "txHistory"],
    defaultURL: "https://tonapi.io",
    load: () => import("./ton.js").then((m) => m.Ton),
  },
  {
    key: "tronscan",
    chains: ["tron"],
    capabilities: ["balances", "txHistory", "txDetail", "blockInfo"],
    defaultURL: "https://apilist.tronscanapi.com",
    load: () => import("./tronscan.js").then((m) => m.Tronscan),
  },
  {
    key: "aptos",
    chains: ["aptos"],
    capabilities: [],
    load: () => import("./aptos.js").then((m) => m.Aptos),
  },
  {
    key: "blockberry",
    chains: ["sui"],
    capabilities: ["balances", "txHistory"],
    defaultURL: "https://api.blockberry.one/sui",
    load: () => import("./blockberry.js").then((m) => m.Blockberry),
  },
  {
    key: "koios",
    chains: ["cardano"],
    capabilities: ["balances", "txHistory", "txDetail", "tokenBalances"],
    defaultURL: "https://api.koios.rest/api/v1",
    load: () => import("./koios.js").then((m) => m.Koios),
  },
  {
    key: "arweave",
    chains: ["arweave"],
    capabilities: ["txHistory", "txDetail"],
    defaultURL: ARWEAVE_GATEWAY_URL,
    load: () => import("./arweave.js").then((m) => m.Arweave),
  },
] satisfies readonly BuiltinProviderEntry[];
