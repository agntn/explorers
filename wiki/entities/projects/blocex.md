---
pageType: entity
entityType: project
id: blocex
canonicalId: blocex
title: blocex
slug: blocex
tags:
  - blockchain
  - block-explorer
  - provider-library
  - cli
  - typescript
  - ai-agents
privacyTier: public
bestUsedFor:
  - unified block explorer access
  - blockchain data normalization
  - AI agent blockchain queries
  - CLI balance/tx/gas lookups
relationships:
  - type: depends_on
    target: chains
    note: workspace dep for CHAIN_DATA
  - type: integrates_with
    target: pi-coding-agent
    note: Pi extension exposes 6 tools
  - type: similar_to
    target: etherscan-api
    note: wraps Etherscan-family APIs
sourceIds:
  - source:github:oritwoen/blocex
updated: 2026-06-08
---

# blocex

Unified block explorer provider library and CLI for AI agents.

## Stack

- **Language**: TypeScript (ESNext, strict, noUncheckedIndexedAccess)
- **Runtime**: Node >=22
- **Package manager**: pnpm 10.x
- **Build**: obuild (bundle mode)
- **CLI**: citty
- **HTTP**: ofetch (15s timeout)
- **Testing**: vitest (live roundtrips, no mocks)
- **Workspace dep**: `chains` (CHAIN_DATA)

## Architecture

Three-layer design: CLI → Core → Providers.

- **CLI** (`cli.ts`, `commands/*.ts`): 7 subcommands, lazy-loaded via dynamic import
- **Core** (`core/*.ts`): Domain types, provider registry, HTTP client, ENS, input classification, errors
- **Providers** (`providers/*.ts`): 9 self-registering providers (etherscan, blockscout, blockchair, mempool, solana, ton, tron, aptos, sui)
- **Pi Extension** (`packages/pi/extensions/blocex.ts`): 6 tools for Pi coding agent

## Entry points

| Entry | Path | Purpose |
|-------|------|---------|
| Library | `src/index.ts` | Re-exports all types, utilities, registry |
| CLI | `src/cli.ts` | `blocex` binary, citty main |
| Pi Extension | `packages/pi/extensions/blocex.ts` | Agent tool registration |

## Providers

| Provider | Auth | Chains | Capabilities |
|----------|------|--------|-------------|
| etherscan | API key | 12 EVM chains | Full |
| blockscout | None | 10 EVM chains | Full |
| blockchair | Optional | 9 chains (BTC+EVM) | balances, tx, contract, block |
| mempool | None | Bitcoin only | balances, tx, gas, block |
| solana | None | Solana | balances, tx, gas, block |
| ton | None | TON | balances, tx, block |
| tron | None | TRON | balances, tx, block |
| aptos | None | Aptos | balances, tx, block |
| sui | None | Sui | balances, tx, gas, block |

## Build commands

```bash
pnpm build       # obuild → dist/
pnpm dev         # obuild --stub
pnpm typecheck   # tsc --noEmit
pnpm test:run    # vitest single run
```

## Known issues

- `bera` chain in Chain type but no provider maps it
- README references removed `CHAIN_SYMBOLS`/`CHAIN_NAMES` exports
- No LICENSE file
- Missing tests for etherscan, blockchair, core utilities, CLI commands
- `chains` workspace dep uses `file:../chains` — not publishable without workaround

## Related

- [[wiki/concepts/blockchain/block-explorer-provider-pattern]]
- [[wiki/concepts/blockchain/chain-normalization]]
