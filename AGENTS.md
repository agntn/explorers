# blocex — AGENTS.md

## Scope

Unified block explorer provider library. Normalizes balances, tx history, contract info, token holdings, gas data across multiple chains and explorer APIs.

## Providers

| Provider | Auth | Chains | Strengths |
|---|---|---|---|
| etherscan | API key (free: 5 req/s) | EVM: eth, base, arb, op, polygon, bsc, avax, ftm, gnosis, linea, zksync, scroll | Most complete: full ABI/source/gas/token support |
| blockscout | none | EVM: eth, base, arb, op, polygon, gnosis, linea, scroll, zksync, avax | Open source, no key needed, REST v2 |
| blockchair | optional key | bitcoin, eth, base, arb, op, polygon, bsc, avax, gnosis | Bitcoin support, multi-chain dashboard |
| mempool | none | bitcoin | Best Bitcoin data: UTXO, fee estimates, mempool, block details |

## Conventions

- Chain names normalized via `normalizeChain()` — accepts aliases like `ethereum`, `mainnet`, `arb`, `btc`
- All values in wei as strings (never float) — `formatWei()` for display
- `noUncheckedIndexedAccess: true` — Record access gives `| undefined`, use `?? ''` for required fields
- Provider registration is side-effect: importing `src/providers/index.js` triggers all `register()` calls
- CLI default subcommand: `balance` (for address-like input) or `providers` (no input)

## Key files

- `src/core/types.ts` — Chain, Transaction, Balance, TokenBalance, ContractInfo, GasData, BlocexProvider
- `src/core/errors.ts` — BlocexError hierarchy + normalizeError
- `src/providers/*.ts` — one file per provider, self-registering

## Constraints

- Etherscan: 5 req/s free tier, needs ETHERSCAN_API_KEY
- Blockscout: no `limit` query param on transactions endpoint — slice locally
- Blockchair: data format differs between BTC and EVM chains
