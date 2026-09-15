import snapshot from "../data/explorers.json";

/** One capability flag of `ProviderCapabilities`, as the registry lists them. */
export type Capability =
  | "balances"
  | "txHistory"
  | "txDetail"
  | "utxos"
  | "contractInfo"
  | "tokenBalances"
  | "tokenTransfers"
  | "gasData"
  | "blockInfo";

export const CAPABILITIES: readonly Capability[] = [
  "balances",
  "txHistory",
  "txDetail",
  "utxos",
  "contractInfo",
  "tokenBalances",
  "tokenTransfers",
  "gasData",
  "blockInfo",
];

/** Short labels for the capability columns. */
export const CAPABILITY_LABELS: Record<Capability, string> = {
  balances: "balance",
  txHistory: "history",
  txDetail: "tx detail",
  utxos: "utxos",
  contractInfo: "contract",
  tokenBalances: "tokens",
  tokenTransfers: "transfers",
  gasData: "gas",
  blockInfo: "block",
};

/** What `scripts/snapshot.mjs` copies out of `builtins` and `@agntn/chains`. */
export interface ProviderSnapshot {
  readonly key: string;
  readonly chains: readonly string[];
  readonly capabilities: readonly Capability[];
  readonly defaultURL: string | null;
  readonly defaultChain: string;
}

export interface ChainSnapshot {
  readonly key: string;
  readonly name: string;
  readonly symbol: string;
  readonly type: string;
  readonly explorer: string | null;
  readonly providers: readonly string[];
}

/** Presentation per provider: icon, blurb and the auth facts that `resolveProvider()` reads from the environment. */
interface ProviderPresentation {
  readonly label: string;
  readonly icon: string;
  /** Environment variables `src/core/resolve.ts` checks for this provider, in order. */
  readonly envVars: readonly string[];
  /** Whether a missing key still lets the provider serve as a fallback (`OPTIONAL_CREDENTIAL_PROVIDERS`). */
  readonly optionalKey?: boolean;
  readonly blurb: string;
}

const PRESENTATION: Record<string, ProviderPresentation> = {
  etherscan: {
    label: "Etherscan",
    icon: "i-solar-code-file-linear",
    envVars: ["ETHERSCAN_API_KEY"],
    blurb: "The v2 API with one key for ten EVM chains. Every operation, five requests a second on the free tier.",
  },
  blockscout: {
    label: "Blockscout",
    icon: "i-solar-global-linear",
    envVars: [],
    blurb: "Keyless and complete. The backstop when nothing else serves a chain, and the first stop when you have no keys at all.",
  },
  blockchair: {
    label: "Blockchair",
    icon: "i-solar-database-linear",
    envVars: ["BLOCKCHAIR_API_KEY"],
    optionalKey: true,
    blurb: "One dashboard API for Bitcoin, Ethereum and eCash. Works without a key, ranks higher with one.",
  },
  mempool: {
    label: "Mempool",
    icon: "i-solar-layers-linear",
    envVars: [],
    blurb: "mempool.space and its Litecoin and Pepecoin siblings. Fees in sat/vB, unspent outputs, OP_RETURN decoded, the mempool delta kept apart.",
  },
  blockstream: {
    label: "Blockstream",
    icon: "i-solar-box-minimalistic-linear",
    envVars: [],
    blurb: "Bitcoin through Esplora. An independent second backend for the same chain, so a Mempool outage isn't your outage.",
  },
  solscan: {
    label: "Solscan",
    icon: "i-solar-bolt-linear",
    envVars: ["SOLSCAN_API_KEY"],
    blurb: "Solana balances, history, details and blocks through the Pro API. Needs a key.",
  },
  helius: {
    label: "Helius",
    icon: "i-solar-server-linear",
    envVars: ["HELIUS_API_KEY"],
    blurb: "Enhanced transactions and DAS token holdings on Solana. No balance endpoint, and it says so instead of faking one.",
  },
  ton: {
    label: "TONAPI",
    icon: "i-simple-icons-ton",
    envVars: [],
    blurb: "Balances and history on TON, Jetton transfers included, failed ones omitted. Keyless.",
  },
  tronscan: {
    label: "TRONSCAN",
    icon: "i-solar-structure-linear",
    envVars: ["TRONSCAN_API_KEY"],
    blurb: "TRON balances, history, details and blocks. Needs a key.",
  },
  aptos: {
    label: "Aptos Explorer",
    icon: "i-solar-info-circle-linear",
    envVars: [],
    blurb: "Registered, honest and empty. Aptos Explorer has no documented account API, so every operation throws UnsupportedOperationError.",
  },
  blockberry: {
    label: "Blockberry",
    icon: "i-solar-bill-list-linear",
    envVars: ["BLOCKBERRY_API_KEY"],
    blurb: "Sui balances and history. Needs a key; block lookup doesn't fit the contract of one block number in, one block out.",
  },
  koios: {
    label: "Koios",
    icon: "i-simple-icons-cardano",
    envVars: [],
    blurb: "Cardano over PostgREST. Balances, history, details and native token holdings, keyless, a little slow on busy addresses.",
  },
  arweave: {
    label: "Arweave gateway",
    icon: "i-solar-history-linear",
    envVars: [],
    blurb: "Wallet and block REST plus the GraphQL index of a gateway. Winstons, no gas, and history that stays on one gateway.",
  },
  dcrdata: {
    label: "dcrdata",
    icon: "i-solar-chart-square-linear",
    envVars: [],
    blurb: "Decred through the Insight API of explorer.dcrdata.org. Atoms, the mempool delta kept apart from the balance, no key.",
  },
};

export interface ProviderInfo extends ProviderSnapshot, ProviderPresentation {
  readonly to: string;
  /** Human wording of the auth column. */
  readonly auth: string;
}

function authText(presentation: ProviderPresentation): string {
  if (presentation.envVars.length === 0) return "none";
  const vars = presentation.envVars.join(", ");
  return presentation.optionalKey ? `optional ${vars}` : vars;
}

export const PROVIDERS: readonly ProviderInfo[] = (
  snapshot.providers as readonly ProviderSnapshot[]
).map((provider) => {
  const presentation = PRESENTATION[provider.key];
  if (!presentation) {
    throw new Error(`docs: no presentation for provider "${provider.key}" in app/utils/providers.ts`);
  }
  return {
    ...provider,
    ...presentation,
    to: `/providers/${provider.key}`,
    auth: authText(presentation),
  };
});

const CHAIN_ICONS: Record<string, string> = {
  ethereum: "i-simple-icons-ethereum",
  base: "i-solar-layers-linear",
  arbitrum: "i-solar-layers-linear",
  optimism: "i-simple-icons-optimism",
  polygon: "i-simple-icons-polygon",
  bsc: "i-simple-icons-bnbchain",
  avalanche: "i-solar-layers-linear",
  gnosis: "i-solar-layers-linear",
  linea: "i-solar-layers-linear",
  berachain: "i-solar-layers-linear",
  scroll: "i-solar-layers-linear",
  zksync: "i-solar-layers-linear",
  bitcoin: "i-simple-icons-bitcoin",
  litecoin: "i-simple-icons-litecoin",
  pepecoin: "i-solar-layers-linear",
  ecash: "i-solar-layers-linear",
  solana: "i-simple-icons-solana",
  ton: "i-simple-icons-ton",
  tron: "i-solar-layers-linear",
  aptos: "i-solar-layers-linear",
  sui: "i-simple-icons-sui",
  cardano: "i-simple-icons-cardano",
  arweave: "i-solar-layers-linear",
  decred: "i-solar-ticket-linear",
};

export interface ChainInfo extends ChainSnapshot {
  readonly icon: string;
}

export const CHAINS: readonly ChainInfo[] = (snapshot.chains as readonly ChainSnapshot[]).map(
  (chain) => ({ ...chain, icon: CHAIN_ICONS[chain.key] ?? "i-solar-layers-linear" }),
);

/**
 * Decimals of each chain's native unit, as the providers pass them to `formatWei()`: 18 on EVM
 * chains, 8 on the Bitcoin family and Decred, 2 on eCash, 9 on Solana, TON and Sui, 6 on TRON
 * and Cardano, 8 on Aptos, 12 on Arweave. Used to show a fee the library returns in the smallest unit.
 */
const NATIVE_DECIMALS: Record<string, number> = {
  bitcoin: 8,
  litecoin: 8,
  pepecoin: 8,
  ecash: 2,
  solana: 9,
  ton: 9,
  sui: 9,
  tron: 6,
  cardano: 6,
  aptos: 8,
  arweave: 12,
  decred: 8,
};

export function nativeDecimals(chain: string): number {
  return NATIVE_DECIMALS[chain] ?? 18;
}

export function isEvm(chain: string): boolean {
  return chainInfo(chain)?.type === "evm";
}

const PROVIDERS_BY_KEY = new Map(PROVIDERS.map((provider) => [provider.key, provider]));
const CHAINS_BY_KEY = new Map(CHAINS.map((chain) => [chain.key, chain]));

export function providerInfo(key: string): ProviderInfo | undefined {
  return PROVIDERS_BY_KEY.get(key);
}

export function providerLabel(key: string): string {
  return providerInfo(key)?.label ?? key;
}

export function providerIcon(key: string): string {
  return providerInfo(key)?.icon ?? "i-solar-server-linear";
}

export function chainInfo(key: string): ChainInfo | undefined {
  return CHAINS_BY_KEY.get(key);
}

export function chainLabel(key: string): string {
  return chainInfo(key)?.name ?? key;
}

export function chainIcon(key: string): string {
  return chainInfo(key)?.icon ?? "i-solar-layers-linear";
}

/** Providers that can serve a capability on a chain, in registry order, the order `resolveProvider()` walks. */
export function providersFor(chain: string, capability?: Capability): readonly ProviderInfo[] {
  return PROVIDERS.filter(
    (provider) =>
      provider.chains.includes(chain) &&
      (capability === undefined || provider.capabilities.includes(capability)),
  );
}
