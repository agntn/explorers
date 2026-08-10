# blocex

Unified block explorer provider library and CLI for AI agents. Normalizes balances, transaction history, contract info, token holdings, gas data, and block info across multiple chains and explorer APIs.

## Features

- **9 providers**: Etherscan, Blockscout, Blockchair, Mempool, Solscan, TON, TRONSCAN, Aptos, Blockberry
- **18 chains**: Ethereum, Base, Arbitrum, Optimism, Polygon, BSC, Avalanche, Fantom, Gnosis, Linea, zkSync, Scroll, Bitcoin, Solana, TON, TRON, Aptos, Sui
- **Self-registering providers**: add new providers by creating a file in `src/providers/` — auto-register on import
- **ENS support**: resolve `.eth` names to addresses (public APIs, no key required)
- **Unified types**: `Balance`, `Transaction`, `TokenBalance`, `ContractInfo`, `GasData`, `BlockInfo`
- **Explorer-only transports**: providers never fall back to direct fullnode RPC
- **CLI + programmatic API**: use from terminal or as a library

## Install

```bash
pnpm add blocex
```

Requires Node >= 22.

## CLI

```bash
npx blocex <subcommand> [args]
```

If the first argument looks like an address (not a known subcommand), it defaults to `balance`.

### Subcommands

| Command     | Description                                | Example                      |
| ----------- | ------------------------------------------ | ---------------------------- |
| `balance`   | Native token balance (supports ENS)        | `blocex balance 0xd8dA...04` |
| `tx`        | Transaction history or detail by hash      | `blocex tx 0xd8dA...04 -n 5` |
| `contract`  | Contract info (ABI, source, verification)  | `blocex contract 0x1f984...` |
| `tokens`    | ERC-20 token holdings                      | `blocex tokens 0xd8dA...04`  |
| `gas`       | Current gas prices                         | `blocex gas -c base`         |
| `block`     | Block info by number                       | `blocex block 18000000`      |
| `providers` | List registered providers and capabilities | `blocex providers`           |

### Common options

| Option           | Description                                                                  |
| ---------------- | ---------------------------------------------------------------------------- |
| `-c, --chain`    | Chain name: `eth`, `base`, `arbitrum`, `bitcoin`, etc.                       |
| `-p, --provider` | Provider: `etherscan`, `blockscout`, `blockchair`, `mempool`, etc.           |
| `-n, --limit`    | Max results (for `tx`)                                                       |
| `-m, --mode`     | `tx` mode: `history` or `detail` (useful for ambiguous hash/address formats) |

### Provider auto-selection

When no `--provider` is specified, blocex picks the best available:

1. First provider whose env vars are all set
2. Falls back to `blockscout` (no API key needed)

## Programmatic API

```typescript
import { create, resolveProvider, normalizeChain } from "blocex";

// Auto-select provider (checks env vars, defaults to Blockscout)
const providerName = resolveProvider();
const provider = create(providerName);

// Or explicitly create a provider
const etherscan = create("etherscan", { apiKey: process.env.ETHERSCAN_API_KEY });

// Get balance
const balance = await provider.getBalance("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", "eth");
console.log(balance.balanceFormatted, balance.symbol);

// Transaction history
const txs = await provider.getTxHistory("0xd8dA...04", "eth", { limit: 10 });

// Contract info is provider-dependent
if (provider.capabilities.contractInfo && provider.getContractInfo) {
  const contract = await provider.getContractInfo("0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984");
}
// Optional operations are available only on providers that advertise them
if (provider.capabilities.tokenBalances && provider.getTokenBalances) {
  const tokens = await provider.getTokenBalances("0xd8dA...04", "eth", {
    nonZeroOnly: true,
  });
}

if (provider.capabilities.gasData && provider.getGasData) {
  const gas = await provider.getGasData("eth");
}

if (provider.capabilities.blockInfo && provider.getBlockInfo) {
  const block = await provider.getBlockInfo(18000000, "eth");
}
// Chain normalization — accepts aliases like 'ethereum', 'mainnet', 'btc'
const chain = normalizeChain("mainnet"); // → 'eth'
```

### ENS resolution

```typescript
import { isEnsName, resolveEns } from "blocex";

if (isEnsName("vitalik.eth")) {
  const address = await resolveEns("vitalik.eth");
}
```

## Providers

| Provider       | Auth                            | Chains                                                                           | Capabilities                                       |
| -------------- | ------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------- |
| **etherscan**  | API key (`ETHERSCAN_API_KEY`)   | eth, base, arbitrum, optimism, polygon, bsc, avalanche, gnosis, linea, bera      | Full: balances, tx, contract, tokens, gas, block   |
| **blockscout** | None                            | eth, base, arbitrum, optimism, polygon, gnosis, linea, scroll, zksync, avalanche | Full: balances, tx, contract, tokens, gas, block   |
| **blockchair** | Optional (`BLOCKCHAIR_API_KEY`) | bitcoin, eth                                                                     | balances, tx, block                                |
| **mempool**    | None                            | bitcoin                                                                          | balances, tx, gas, block                           |
| **solscan**    | API key (`SOLSCAN_API_KEY`)     | solana                                                                           | balances, tx detail/history, block                 |
| **ton**        | None                            | ton                                                                              | balances, tx                                       |
| **tronscan**   | API key (`TRONSCAN_API_KEY`)    | tron                                                                             | balances, tx detail/history, block                 |
| **aptos**      | None                            | aptos                                                                            | unsupported until a documented explorer API exists |
| **blockberry** | API key (`BLOCKBERRY_API_KEY`)  | sui                                                                              | balances, tx history                               |

`aptos` remains registered so provider selection is stable, but its required methods throw
`UnsupportedOperationError` rather than reading from Aptos fullnode REST.

### Adding a provider

1. Create a concrete class that extends `Provider` in `src/providers/myprovider.ts`
2. Add a unique `static readonly key = "myprovider"`; the inherited instance `name` reads it
3. Implement required methods and advertise optional methods through `capabilities`
4. Call `register(MyProvider, defaultURL)` at module scope
5. Import the module in `src/providers/index.ts`

Providers self-register through side-effect imports. Importing `blocex` loads the provider barrel and registers every built-in provider.

## Types

All native and token amounts use strings in the chain's smallest unit to avoid floating-point precision loss. Pass the asset's decimal count to `formatWei(value, decimals)`; omitting it is only correct for 18-decimal assets:

```typescript
import { formatWei } from "blocex";

formatWei("1000000000000000000"); // → '1'
formatWei("1500000000000000000"); // → '1.5'
formatWei("123456789", 8); // → '1.23456789' (BTC)
formatWei("1500000000", 9); // → '1.5' (SOL)
```

### Chain utilities

```typescript
import { normalizeChain } from "blocex";

normalizeChain("mainnet"); // → 'eth'
normalizeChain("btc"); // → 'bitcoin'
normalizeChain("coinbase"); // → 'base'
normalizeChain("apt"); // → 'aptos'
```

## Error handling

```typescript
import { normalizeError } from "blocex";

try {
  await provider.getBalance(address);
} catch (error) {
  const blocexError = normalizeError(error, "etherscan");
  // blocexError is one of: HTTPError, AuthError, RateLimitError, NotFoundError,
  // UnsupportedChainError, UnsupportedOperationError
}
```

## Development

```bash
pnpm install
pnpm build      # build dist/
pnpm test       # vitest watch
pnpm test:run   # single run
pnpm typecheck  # tsc --noEmit
```
