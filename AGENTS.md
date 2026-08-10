# blocex — AGENTS.md

## Scope

Unified block explorer provider library. Normalizes balances, tx history, contract info, token holdings, gas data, and block info across multiple chains and explorer APIs. Exports both CLI (`blocex` binary) and programmatic API.

## Providers

| Provider   | Auth                    | Chains                                                                           | Capabilities                                     |
| ---------- | ----------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------ |
| etherscan  | API key (free: 5 req/s) | eth, base, arbitrum, optimism, polygon, bsc, avalanche, gnosis, linea, bera      | Full: balances, tx, contract, tokens, gas, block |
| blockscout | none                    | eth, base, arbitrum, optimism, polygon, gnosis, linea, scroll, zksync, avalanche | Full: balances, tx, contract, tokens, gas, block |
| blockchair | optional key            | bitcoin, eth                                                                     | balances, tx, block                              |
| mempool    | none                    | bitcoin                                                                          | balances, tx, gas, block                         |
| solana     | none                    | solana                                                                           | balances, tx, gas, block                         |
| ton        | none                    | ton                                                                              | balances, tx                                     |
| tron       | none                    | tron                                                                             | balances, tx, block                              |
| aptos      | none                    | aptos                                                                            | balances, tx, block                              |
| sui        | none                    | sui                                                                              | balances, tx, gas, block                         |

## Conventions

- Chain names normalized via `normalizeChain()` — accepts aliases like `ethereum`, `mainnet`, `arb`, `btc`
- Native and token amounts use strings in each chain's smallest unit — call `formatWei(value, decimals)` with the asset's decimals; its default is 18
- `noUncheckedIndexedAccess` and `noImplicitOverride` are enabled — guard indexed access and mark overrides explicitly
- Provider registration is a class side effect: each concrete class owns a static `providerName`, and importing `src/providers/index.js` triggers all `register()` calls
- CLI default subcommand: `balance` (for address-like input) or `providers` (no input)
- Error hierarchy: `BlocexError` → `HTTPError`, `AuthError`, `RateLimitError`, `NotFoundError`, `UnsupportedChainError`, `UnknownProviderError`
- HTTP client uses `ofetch` with a 15s default timeout and preserves out-of-range JSON integers as strings

## Key files

- `src/core/types.ts` — re-exports `Chain` from `chains`; owns transaction, balance, token, contract, gas, block, and provider-config types
- `src/core/provider.ts` — abstract `Provider` base class and optional operation contract
- `src/core/errors.ts` — BlocexError hierarchy + normalizeError
- `src/core/registry.ts` — Self-registering provider registry (register, create, providers, has)
- `src/core/resolve.ts` — Auto-select provider by env vars, default blockscout
- `src/core/client.ts` — HTTP client wrapper (ofetch)
- `src/core/ens.ts` — ENS resolution (public APIs, no keccak dependency)
- `src/core/input.ts` — User input classification (address/txhash/ens)
- `src/providers/*.ts` — One file per provider, self-registering via `register()`
- `src/commands/*.ts` — CLI subcommands (balance, tx, contract, tokens, gas, block, providers)
- `src/cli.ts` — Citty CLI entry point

## CLI subcommands

`balance`, `tx`, `contract`, `tokens`, `gas`, `block`, `providers` — all support `-c` (chain), `-p` (provider). `tx` accepts `-m history|detail` to resolve ambiguous hash/address formats. `tx` and `balance` support ENS.

## Constraints

- Etherscan: 5 req/s free tier, needs `ETHERSCAN_API_KEY`
- Blockchair: data format differs between BTC and EVM chains
- Solana/TON/TRON/Aptos/Sui: single-chain providers, throw `UnsupportedChainError` for other chains
- TON: the TonAPI block endpoint requires workchain, shard, and seqno rather than the library's single block-number contract, so `blockInfo` is unsupported
- Mempool: Bitcoin only

## Architecture

Three-layer design: **CLI** → **Core** → **Providers**.

```mermaid
graph TB
  CLI["CLI (citty)"] --> Core
  Core --> Providers
  Providers --> External["External APIs"]
  PiExt["Pi Extension"] -.-> Core
  PiExt -.-> Providers
  Types["types.ts"] -.-> Chains["chains (workspace dep)"]
```

### Layer breakdown

- **CLI Layer** (`cli.ts`, `commands/*.ts`): citty-based CLI, lazy-loads subcommands via dynamic `import()`. `cli-args.ts` normalizes bare address input to `balance` subcommand.
- **Core Layer** (`core/*.ts`): Domain types, provider registry (side-effect registration), HTTP client (ofetch, 15s timeout), ENS resolution (public APIs), input classification, error hierarchy.
- **Provider Layer** (`providers/*.ts`): 9 self-registering providers. Each file defines API types, helper mappers, a concrete `Provider` subclass with a static registry key, and calls `register()` with its constructor at module scope.
- **Pi Extension** (`packages/pi/extensions/blocex.ts`): Exposes 6 tools to Pi coding agent. Lazy-loads blocex via dynamic import with fallback to source.

### Provider categories

1. **Multi-chain EVM** (etherscan, blockscout): support 10 EVM chains each
2. **Bitcoin/Ethereum bridge** (blockchair): dashboard API for Bitcoin and Ethereum
3. **Bitcoin** (mempool): UTXO model
4. **Single-chain non-EVM** (solana, ton, tron, aptos, sui): all implement balances and history; optional capabilities vary by provider

## Patterns

- **Side-effect registration**: `import './providers/index.js'` triggers all `register()` calls. Each class owns its registry key as `static providerName`.
- **String-only values**: All wei/satoshi/native amounts are strings (`Balance.balance`, `TokenBalance.balance`). The HTTP boundary preserves unsafe JSON integers as strings; `formatWei()` converts amounts for display.
- **Optional methods**: `getTxDetail`, `getContractInfo`, `getTokenBalances`, `getGasData`, and `getBlockInfo` are optional on `Provider`. Always check both the `capabilities` getter and method presence before calling.
- **Dynamic CLI imports**: Each subcommand is lazily loaded via `() => import('./commands/X.js').then(m => m.default)`.
- **Chain normalization**: `normalizeChain()` delegates to the shared `chains` dictionary for canonical keys and aliases (`ethereum→eth`, `btc→bitcoin`, `arb→arbitrum`). Missing input defaults to `eth`; unknown names throw.
- **Provider auto-selection**: `resolveProvider()` checks env vars for each provider, falls back to `blockscout` (no key needed).
- **Error sanitization**: `HTTPError` strips API keys from URLs in error messages. `normalizeError()` wraps unknown errors into typed `BlocexError` subclasses.

## Anti-patterns to avoid

- Importing individual provider files without the barrel — breaks registration chain
- Calling an optional provider method without checking `capabilities` and method presence — unsupported operations stay absent at runtime
- Assuming EVM address formats work on non-EVM chains (Solana base58, TON base64, TRON base58/hex)
- Hardcoding chain names — always use `normalizeChain()` for user input

## Test coverage gaps

**Covered** (18 test files): provider base/registry, provider resolution, HTTP client, path safety, amount formatting, errors, input classification, chain normalization, CLI argument routing, plus all nine providers.
**Missing**: CLI command execution and the Pi extension.
**Test style**: Focused unit tests for local contracts plus live public-API roundtrips for providers.

## Dependencies

- `chains` (bundled workspace dev dependency via `file:../chains`): canonical chain metadata, types, and aliases
- `citty`: CLI framework
- `consola`: Logging
- `ofetch`: HTTP client
- `obuild`: Build tool (bundle mode)
- `vitest`: Testing

## Build & Scripts

```bash
pnpm build          # obuild → dist/
pnpm dev            # obuild --stub (watch mode)
pnpm typecheck      # tsc --noEmit
pnpm test           # vitest watch
pnpm test:run       # vitest single run
```

## Onboard Progress

- [x] Phase 1: DISCOVER — structure mapped, root AGENTS.md
- [x] Phase 2: ABSORB — all source read, patterns extracted
- [x] Phase 3: WIKI — 3 concept pages, 1 entity page (updated from 3→9 providers)
- [x] Phase 4: MEMORY — 10 facts retained
- [x] Phase 5: EVOLVE — updated AGENTS.md, created src/AGENTS.md, updated wiki entity

<!-- gitnexus:start -->

# GitNexus — Code Intelligence

This project is indexed by GitNexus as **blocex** (527 symbols, 1435 relationships, 43 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource                                | Use for                                  |
| --------------------------------------- | ---------------------------------------- |
| `gitnexus://repo/blocex/context`        | Codebase overview, check index freshness |
| `gitnexus://repo/blocex/clusters`       | All functional areas                     |
| `gitnexus://repo/blocex/processes`      | All execution flows                      |
| `gitnexus://repo/blocex/process/{name}` | Step-by-step execution trace             |

## CLI

| Task                                         | Read this skill file                                        |
| -------------------------------------------- | ----------------------------------------------------------- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md`       |
| Blast radius / "What breaks if I change X?"  | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?"             | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md`       |
| Rename / extract / split / refactor          | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md`     |
| Tools, resources, schema reference           | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md`           |
| Index, status, clean, wiki CLI commands      | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md`             |

<!-- gitnexus:end -->
