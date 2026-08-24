# Explorers

Ten block explorer APIs, one shape.

Block explorers keep returning roughly the same data in completely different formats. Explorers deals with that mess and gives scripts, agents and humans one TypeScript API and one CLI for balances, transactions, token transfers, contracts, tokens, gas and blocks.

## Features

- **Ten providers, one contract.** Etherscan, Blockscout, Blockchair, Mempool, Solscan, Helius, TON, TRONSCAN, Aptos and Blockberry.
- **18 chains.** Ethereum, Base, Arbitrum, Optimism, Polygon, BSC, Avalanche, Gnosis, Linea, Berachain, zkSync, Scroll, Bitcoin, Solana, TON, TRON, Aptos and Sui.
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

OMP loads `packages/omp/extensions/explorers.ts` through the package's `omp.extensions` manifest. It registers six read-only tools for balances, transaction history and details, contract metadata, gas prices and provider discovery. The existing Pi entrypoint remains under `packages/pi/extensions/`.

## CLI

The short path is usually enough:

```bash
npx @agntn/explorers vitalik.eth
npx @agntn/explorers tx vitalik.eth -n 5
npx @agntn/explorers providers
```

An address-like first argument defaults to `balance`. No ceremonial subcommand needed.

### Commands

| Command     | What it does                                | Example                           |
| ----------- | ------------------------------------------- | --------------------------------- |
| `balance`   | Native token balance, including ENS         | `explorers balance vitalik.eth`   |
| `tx`        | Transaction history or one transaction      | `explorers tx vitalik.eth -n 5`   |
| `contract`  | ABI, source and verification status         | `explorers contract 0x1f984...`   |
| `tokens`    | ERC-20 holdings                             | `explorers tokens vitalik.eth`    |
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

Without `--provider`, Explorers first checks configured API keys and then falls back to Blockscout. It has no key requirement and is a much better default than failing before the first request.

## TypeScript

```typescript
import { create, resolveEns, resolveProvider } from "@agntn/explorers";

const provider = create(resolveProvider());
const address = await resolveEns("vitalik.eth");
if (!address) throw new Error("ENS name did not resolve");

const balance = await provider.getBalance(address, "eth");
const transactions = await provider.getTxHistory(address, "eth", { limit: 10 });

console.log(`${balance.balanceFormatted} ${balance.symbol}`);
console.log(transactions.map((transaction) => transaction.hash));

if (provider.capabilities.contractInfo && provider.getContractInfo) {
  const contract = await provider.getContractInfo(
    "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984",
    "eth",
  );
  console.log(contract.isVerified, contract.name);
}
```

Required operations live on `Provider`. Optional operations stay absent when a backend cannot serve them, so check both `capabilities` and the method before calling. No fake fallback and no method that returns convincing nonsense.

## Providers

| Provider       | Auth                          | Chains                                                                           | Capabilities                                          |
| -------------- | ----------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **etherscan**  | `ETHERSCAN_API_KEY`           | eth, base, arbitrum, optimism, polygon, bsc, avalanche, gnosis, linea, bera      | balances, tx, transfers, contract, tokens, gas, block |
| **blockscout** | None                          | eth, base, arbitrum, optimism, polygon, gnosis, linea, scroll, zksync, avalanche | balances, tx, transfers, contract, tokens, gas, block |
| **blockchair** | Optional `BLOCKCHAIR_API_KEY` | bitcoin, eth                                                                     | balances, tx, block                                   |
| **mempool**    | None                          | bitcoin                                                                          | balances, tx, gas, block                              |
| **solscan**    | `SOLSCAN_API_KEY`             | solana                                                                           | balances, tx detail/history, block                    |
| **helius**     | `HELIUS_API_KEY`              | solana                                                                           | tx detail/history                                     |
| **ton**        | None                          | ton                                                                              | balances, tx                                          |
| **tronscan**   | `TRONSCAN_API_KEY`            | tron                                                                             | balances, tx detail/history, block                    |
| **aptos**      | None                          | aptos                                                                            | no supported explorer operations                      |
| **blockberry** | `BLOCKBERRY_API_KEY`          | sui                                                                              | balances, tx history                                  |

`aptos` is deliberately boring. It stays registered, advertises no capabilities and throws `UnsupportedOperationError` from required methods. Aptos Explorer has no documented account/history API, and hiding fullnode REST behind an explorer provider just to make the table look complete would be dishonest.

## Data and errors

Wallet amounts stay as strings in the chain's smallest unit. Converting them to JavaScript numbers is an easy way to lose precision without noticing. Use `formatWei(value, decimals)` for display. The default is 18 decimals, so pass `8` for BTC, `9` for SOL and whatever the actual token uses.

Bitcoin transactions from `mempool` expose their OP_RETURN data in `opReturn`. Every push arrives as raw `hex`, plus a `text` reading when the bytes are printable UTF-8. Binary carriers such as Runes or Omni keep the hex and skip the text instead of handing you mojibake.

`normalizeChain()` accepts practical aliases such as `mainnet`, `btc`, `coinbase` and `apt`. Unknown names fail instead of silently selecting another chain.

Explorer APIs fail in enough creative ways, so errors share one hierarchy: `ExplorerError`, `HTTPError`, `AuthError`, `RateLimitError`, `NotFoundError`, `UnsupportedChainError`, `UnsupportedOperationError` and `UnknownProviderError`. `normalizeError()` turns unknown transport failures into that shape and strips API keys from URLs before they reach logs.

## Adding a provider

A new backend is five steps:

1. Create a class extending `Provider` in `src/providers/`.
2. Give it one unique `static readonly key`.
3. Implement balances and transaction history, then advertise only the optional methods that really work.
4. Register the class at module scope.
5. Import it from `src/providers/index.ts`.

Importing `@agntn/explorers` loads the provider barrel and triggers registration. There is no separate registry list to forget.

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
