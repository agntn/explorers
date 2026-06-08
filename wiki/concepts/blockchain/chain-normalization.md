---
pageType: concept
id: chain-normalization
title: Chain Normalization
slug: chain-normalization
tags:
  - blockchain
  - normalization
  - ux
related_concepts:
  - block-explorer-provider-pattern
related_entities:
  - blocex
sourceIds:
  - source:github:oritwoen/blocex
updated: 2026-06-08
---

# Chain Normalization

Converting various user-provided chain names into canonical identifiers.

## What

Users refer to the same chain in many ways: `ethereum`, `mainnet`, `eth`, `ETH`. Chain normalization maps all variants to a single canonical key used internally.

## How it works (in blocex)

`normalizeChain(input)` in `core/types.ts:291`:

1. Lowercases and trims input
2. Checks canonical keys from `CHAIN_DATA` (from `chains` workspace dep)
3. Checks aliases map: `ethereum→eth`, `btc→bitcoin`, `arb→arbitrum`, `matic→polygon`, etc.
4. Falls back to `eth` if unrecognized

## Claims

- `normalizeChain()` accepts both canonical chain keys and common aliases (`core/types.ts:294-312`)
- Default fallback is `eth` — not an error (`core/types.ts:292`)
- Chain type is a string union: `'eth' | 'base' | 'arbitrum' | ... | 'sui'` (`core/types.ts:10-14`)

## QA

- **Q: What happens with an unrecognized chain name?**
  A: Returns `'eth'` as default. No error thrown — this is intentional for CLI UX where users might pass arbitrary input.

- **Q: Why does the Chain type include `bera` but no provider supports it?**
  A: `bera` was added to the type union (likely for BeraChain) but no provider implementation exists yet. This is a known gap.

## Related

- [[wiki/concepts/blockchain/block-explorer-provider-pattern]]
- [[wiki/entities/projects/blocex]]
