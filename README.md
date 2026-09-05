# Explorers

Thirteen block explorer APIs, one shape.

Block explorers keep returning roughly the same data in completely different formats. Explorers deals with that mess and gives scripts, agents and humans one TypeScript API and one CLI for balances, transactions, token transfers, contracts, tokens, gas and blocks.

## Features

- **Thirteen providers, one contract.** Etherscan, Blockscout, Blockchair, Mempool, Blockstream, Solscan, Helius, TON, TRONSCAN, Aptos, Blockberry, Koios and Arweave.
- **23 chains.** Ethereum, Base, Arbitrum, Optimism, Polygon, BSC, Avalanche, Gnosis, Linea, Berachain, zkSync, Scroll, Bitcoin, Litecoin, Pepecoin, eCash, Solana, TON, TRON, Aptos, Sui, Cardano and Arweave.
- **Explorer data stays explorer data.** A provider never quietly falls back to a fullnode RPC just to pretend an operation is supported.
- **Amounts stay exact.** Native and token values use strings in the chain's smallest unit instead of lossy JavaScript numbers.
- **CLI, library and agent extensions.** Use the same provider contract from a terminal, TypeScript, OMP or Pi.
- **ENS works where it should.** Balance and transaction commands accept `.eth` names without another dependency.

## Install

```bash
pnpm add @agntn/explorers
```

Requires Node.js 24 or newer.

## Agent extensions

Explorers ships separate entrypoints for OMP and Pi. Installing the OMP extension does not replace or reuse the Pi integration.

Install the published package in OMP:

```bash
omp install @agntn/explorers
```

From a source checkout, link the local package instead:

```bash
omp install .
```

OMP loads `packages/omp/extensions/explorers.ts` through the package's `omp.extensions` manifest. It registers nine read-only tools for balances, transaction history and details, contract metadata, token holdings, token transfers, gas prices, blocks and provider discovery. The existing Pi entrypoint remains under `packages/pi/extensions/` and registers the same nine.

## CLI

The short path is usually enough:

```bash
npx @agntn/explorers vitalik.eth
npx @agntn/explorers tx vitalik.eth -n 5
npx @agntn/explorers providers
```

An address-like first argument defaults to `balance`. No ceremonial subcommand needed. When both provider and chain are omitted, balance reads start on Ethereum; selecting a provider explicitly keeps that provider's default chain.

### Commands

| Command     | What it does                                | Example                           |
| ----------- | ------------------------------------------- | --------------------------------- |
| `balance`   | Native token balance, including ENS         | `explorers balance vitalik.eth`   |
| `tx`        | Transaction history or one transaction      | `explorers tx vitalik.eth -n 5`   |
| `contract`  | ABI, source and verification status         | `explorers contract 0x1f984...`   |
| `tokens`    | ERC-20, SPL and Cardano native holdings     | `explorers tokens vitalik.eth`    |
| `transfers` | ERC-20 transfer history for an address      | `explorers transfers vitalik.eth` |
| `gas`       | Current gas prices                          | `explorers gas -c base`           |
| `block`     | Block data by number                        | `explorers block 18000000`        |
| `providers` | Registered providers and their capabilities | `explorers providers`             |

### Common options

| Option           | Meaning                                                                |
| ---------------- | ---------------------------------------------------------------------- |
| `-c, --chain`    | Chain name or alias, for example `eth`, `mainnet`, `btc` or `arbitrum` |
| `-p, --provider` | Explorer backend, for example `etherscan`, `blockscout` or `mempool`   |
| `-n, --limit`    | Maximum number of transactions                                         |
| `-m, --mode`     | Force `tx` into `history` or `detail` mode when the input is ambiguous |
| `-t, --token`    | Limit `transfers` to one token contract                                |

Without `--provider`, Explorers filters candidates by the requested chain and operation, then checks configured API keys before keyless providers. Blockscout remains the final backstop when no provider matches the chain.

## TypeScript

```typescript
import { create, resolveEns, resolveProvider } from "@agntn/explorers";

const provider = await create(resolveProvider(undefined, "ethereum"));
const address = await resolveEns("vitalik.eth");
if (!address) throw new Error("ENS name did not resolve");

const balance = await provider.getBalance(address, "ethereum");
const transactions = await provider.getTxHistory(address, "ethereum", { limit: 10 });

console.log(`${balance.balanceFormatted} ${balance.symbol}`);
console.log(transactions.map((transaction) => transaction.hash));

if (provider.capabilities.contractInfo && provider.getContractInfo) {
  const contract = await provider.getContractInfo(
    "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984",
    "ethereum",
  );
  console.log(contract.isVerified, contract.name);
}
```

UTXO providers that expose cumulative totals add `funded` and `spent` to `Balance`, in the chain's smallest native unit.

Required operations live on `Provider`. Optional operations stay absent when a backend cannot serve them, so check both `capabilities` and the method before calling. Unsupported operations have no stub that returns convincing nonsense. Every successful `Balance` includes its ISO read time plus nullable block height and hash fields, so an unavailable chain position stays explicit.

`create()` imports the provider it was asked for and nothing else, which is why it returns a promise. Everything the registry answers without an instance stays synchronous: `providers()`, `has()`, `supportsChain()`, `supportsCapability()`, `getDefaultURL()` and `resolveProvider()` read the metadata in `builtins`. Pass a capability as the third `resolveProvider()` argument when automatic selection must support a particular operation. A single backend can also skip the registry: `import { Mempool } from "@agntn/explorers/providers/mempool"` gives you the class and leaves the other providers out of your bundle.

`withProvider()` keeps an explicit provider strict. With neither provider nor chain, it starts on Ethereum; an explicit provider without a chain keeps that provider's default. Its optional fourth argument filters automatic selection by capability. Automatic reads get one try on the next available built-in provider after `RateLimitError` or `PlanRestrictedError`. Every other failure stays with the first provider. Its callback can run twice, so it belongs to read operations. Every CLI, MCP, Pi and OMP path that reads chain data requests its operation capability through this dispatcher.

## Providers

| Provider        | Auth                          | Chains                                                                                | Capabilities                                          |
| --------------- | ----------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **etherscan**   | `ETHERSCAN_API_KEY`           | ethereum, base, arbitrum, optimism, polygon, bsc, avalanche, gnosis, linea, berachain | balances, tx, transfers, contract, tokens, gas, block |
| **blockscout**  | None                          | ethereum, base, arbitrum, optimism, polygon, gnosis, linea, scroll, zksync, avalanche | balances, tx, transfers, contract, tokens, gas, block |
| **blockchair**  | Optional `BLOCKCHAIR_API_KEY` | bitcoin, ethereum, ecash                                                              | balances, tx, block                                   |
| **mempool**     | None                          | bitcoin, litecoin, pepecoin                                                           | balances, tx; gas and block on Bitcoin and Litecoin   |
| **blockstream** | None                          | bitcoin                                                                               | balances, tx detail/history, block                    |
| **solscan**     | `SOLSCAN_API_KEY`             | solana                                                                                | balances, tx detail/history, block                    |
| **helius**      | `HELIUS_API_KEY`              | solana                                                                                | tx detail/history, tokens                             |
| **ton**         | None                          | ton                                                                                   | balances, tx                                          |
| **tronscan**    | `TRONSCAN_API_KEY`            | tron                                                                                  | balances, tx detail/history, block                    |
| **aptos**       | None                          | aptos                                                                                 | no supported explorer operations                      |
| **blockberry**  | `BLOCKBERRY_API_KEY`          | sui                                                                                   | balances, tx history                                  |
| **koios**       | None                          | cardano                                                                               | balances, tx detail/history, tokens                   |
| **arweave**     | None                          | arweave                                                                               | tx detail/history                                     |

`arweave` reads transaction history and details from the [gateway GraphQL index](https://docs.ar.io/apis/ar-io-node/index-querying), without an API key. `baseUrl` is the gateway root, defaulting to `https://arweave.net`. Balances, blocks, gas, contracts and token holdings remain unsupported rather than falling back to node HTTP endpoints.

History includes sent and received transactions, removes self-transfer duplicates, and supports `sort`, inclusive `startBlock`/`endBlock`, `limit` (1 to 100, default 100) and `page` (starting at 1). Each read is limited to a window where `page * limit <= 1000`; use block bounds to narrow older history. Index coverage depends on the gateway, particularly for bundled data items. Quantity and top-level transaction fees use winstons (12 decimals). Bundle membership, data metadata and tags remain in `raw`; a data item's fee is omitted because its parent pays the network fee. An empty recipient stays `""`, not contract creation. A missing block means pending, with block number 0 and no timestamp. SmartWeave and AO execution status are not inferred from inclusion in an Arweave block.

Arweave addresses and transaction IDs have the same shape. Use `-m detail` for a transaction ID:

```bash
explorers tx FPjbN_btYKzcf8QASjs30v5C0FPv7XpwKXENBW8dqVw -c arweave -n 3
explorers tx 2Bg8S0GcQmbC-FeT5dDKcj0WOK2YmH7Y4mlW-mO8_yE -p arweave -m detail
```

`aptos` is deliberately boring. It stays registered, advertises no capabilities and throws `UnsupportedOperationError` from required methods. Aptos Explorer has no documented account/history API, and hiding fullnode REST behind an explorer provider just to make the table look complete would be dishonest.

## Data and errors

Wallet amounts stay as strings in the chain's smallest unit. Converting them to JavaScript numbers is an easy way to lose precision without noticing. Use `formatWei(value, decimals)` for display. The default is 18 decimals, so pass `8` for BTC, `9` for SOL and whatever the actual token uses.

Bitcoin, Litecoin and Pepecoin transactions from `mempool` expose their OP_RETURN data in `opReturn`. Every push arrives as raw `hex`, plus a `text` reading when the bytes are printable UTF-8. Binary carriers such as Runes or Omni keep the hex and skip the text instead of handing you mojibake.

`normalizeChain()` accepts practical aliases such as `mainnet`, `btc`, `coinbase` and `apt`. Unknown names fail instead of silently selecting another chain.

Explorer APIs fail in enough creative ways, so errors share one hierarchy: `ExplorerError`, `HTTPError`, `AuthError`, `RateLimitError`, `PlanRestrictedError`, `NotFoundError`, `UnsupportedChainError`, `UnsupportedOperationError` and `UnknownProviderError`. `normalizeError()` turns unknown transport failures into that shape and strips API keys from URLs before they reach logs.

## Adding a provider

A new backend is five steps:

1. Create a class extending `Provider` in `src/providers/`.
2. Give it one unique `static readonly key`.
3. Implement balances and transaction history, then advertise only the optional methods that really work.
4. Export the class.
5. Add an entry to `builtins` in `src/providers/index.ts` with its chains, its public endpoint and a `load` that imports the module.
6. Add the file to `build.config.ts` so it ships as its own bundle.

The entry carries what the registry answers without an instance, so listing providers or matching a chain never loads explorer code. Skipping a step is not silent: `test/unit/registry.test.ts` compares the list against the files on disk, against the key of the class each entry loads, and against the build inputs.

## Development

```bash
pnpm install
pnpm fmt
pnpm lint
pnpm typecheck
pnpm test:run
pnpm build
```

## License

MIT
