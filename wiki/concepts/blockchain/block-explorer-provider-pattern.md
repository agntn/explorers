---
pageType: concept
id: block-explorer-provider-pattern
title: Block Explorer Provider Pattern
slug: block-explorer-provider-pattern
tags:
  - blockchain
  - provider-pattern
  - normalization
  - architecture
related_concepts:
  - chain-normalization
  - self-registering-providers
related_entities:
  - blocex
sourceIds:
  - source:github:oritwoen/blocex
updated: 2026-06-08
---

# Block Explorer Provider Pattern

A design pattern for normalizing heterogeneous block explorer APIs into a unified interface.

## What

Multiple block explorers (Etherscan, Blockscout, Mempool, etc.) expose different APIs with different data shapes. The provider pattern defines a single `BlocexProvider` interface that all explorers implement, letting consumers use one API regardless of which explorer backs it.

## When to use

- Building tools that query multiple blockchains
- Needing to swap explorer backends without changing consumer code
- Exposing blockchain data to AI agents or CLI tools

## How it works (in blocex)

1. **Interface**: `BlocexProvider` defines `getBalance()`, `getTxHistory()`, `getTxDetail()`, `getContractInfo()`, plus optional `getTokenBalances()`, `getGasData()`, `getBlockInfo()`
2. **Registration**: Each provider file calls `register(name, factory)` at module scope
3. **Resolution**: `resolveProvider()` auto-selects based on env vars, defaults to blockscout
4. **Normalization**: All providers return the same domain types (`Balance`, `Transaction`, `TokenBalance`, etc.)

## Claims

- All balance/amount values are strings (never float) to avoid precision loss across BigInt chains (`core/types.ts` formatWei)
- Provider capabilities are declared via `ProviderCapabilities` — callers must check before calling optional methods (`core/types.ts:182`)
- Error sanitization strips API keys from HTTPError messages before throwing (`core/errors.ts:13`)

## Trade-offs

| Approach | Pros | Cons |
|----------|------|------|
| Unified interface | One API for all chains | Optional methods need runtime checks |
| Side-effect registration | Zero-config provider loading | Hard to tree-shake, import order matters |
| String-only amounts | No precision loss | Requires `formatWei()` for display |

## QA

- **Q: Why are `getTokenBalances`, `getGasData`, `getBlockInfo` optional?**
  A: Not all explorers support all features. Bitcoin explorers don't have ERC-20 tokens. Single-chain providers (Solana, TON) don't need multi-chain support.

- **Q: How does provider auto-selection work?**
  A: `resolveProvider()` checks env vars for each provider (e.g., `ETHERSCAN_API_KEY`). First provider with all env vars set wins. Falls back to `blockscout` (no key needed).

## Related

- [[wiki/concepts/blockchain/chain-normalization]]
- [[wiki/entities/projects/blocex]]
