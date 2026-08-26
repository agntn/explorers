# Changelog

## v0.3.0

[compare changes](https://github.com/agntn/explorers/compare/v0.2.0...v0.3.0)

### 🚀 Enhancements

- Add explorers MCP command ([#1](https://github.com/agntn/explorers/pull/1))
- Add token transfer history ([#6](https://github.com/agntn/explorers/pull/6))
- Add Helius provider ([#7](https://github.com/agntn/explorers/pull/7))
- Read OP_RETURN messages from Bitcoin transactions ([#12](https://github.com/agntn/explorers/pull/12))
- Register the token and block tools in the OMP and Pi extensions ([#13](https://github.com/agntn/explorers/pull/13))
- Serve Litecoin through the mempool provider ([#15](https://github.com/agntn/explorers/pull/15))
- Check many addresses in one balance call ([#21](https://github.com/agntn/explorers/pull/21))

### 🩹 Fixes

- Handle pending Blockscout transactions ([#5](https://github.com/agntn/explorers/pull/5))
- ⚠️  Route provider auto-selection by requested chain ([#8](https://github.com/agntn/explorers/pull/8))

### 💅 Refactors

- ⚠️  Use the published @agntn/chains registry ([#4](https://github.com/agntn/explorers/pull/4))
- ⚠️  Stop loading ten providers to use one ([#22](https://github.com/agntn/explorers/pull/22))

### 🏡 Chore

- Publish explorers under @agntn ([#2](https://github.com/agntn/explorers/pull/2))

### 🤖 CI

- Publish releases through GitHub OIDC ([#3](https://github.com/agntn/explorers/pull/3))

#### ⚠️ Breaking Changes

- ⚠️  Route provider auto-selection by requested chain ([#8](https://github.com/agntn/explorers/pull/8))
- ⚠️  Use the published @agntn/chains registry ([#4](https://github.com/agntn/explorers/pull/4))
- ⚠️  Stop loading ten providers to use one ([#22](https://github.com/agntn/explorers/pull/22))

### ❤️ Contributors

- Ori ([@oritwoen](https://github.com/oritwoen))
- Aeitwoen <aeitwoen@gmail.com>

## v0.2.0

### 🚀 Enhancements

- Blocex — unified block explorer provider for agents ([6eff46e](https://github.com/agntn/explorers/commit/6eff46e))
- ENS name resolution — oritwoen.eth, vitalik.eth work in all commands ([4053df1](https://github.com/agntn/explorers/commit/4053df1))
- Mempool.space provider — Bitcoin block explorer (public, no key) ([84ddaca](https://github.com/agntn/explorers/commit/84ddaca))
- Solana provider — Solana public RPC (no key, native SOL) ([0be9b1b](https://github.com/agntn/explorers/commit/0be9b1b))
- Ton provider — The Open Network via tonapi.io (no key, Telegram blockchain) ([9deb99f](https://github.com/agntn/explorers/commit/9deb99f))
- Tron provider — TRON via TronGrid public API (no key) ([887d494](https://github.com/agntn/explorers/commit/887d494))
- Aptos provider — Aptos Labs public API (no key) ([4f1f902](https://github.com/agntn/explorers/commit/4f1f902))
- Sui provider — Sui public JSON-RPC (no key) ([45cbceb](https://github.com/agntn/explorers/commit/45cbceb))
- Improve Pi extension integration ([7da0a56](https://github.com/agntn/explorers/commit/7da0a56))
- Add OMP explorer extension ([9a695f6](https://github.com/agntn/explorers/commit/9a695f6))

### 🩹 Fixes

- **security:** Strip API keys from error messages — sanitizeUrl in HTTPError ([54f30ec](https://github.com/agntn/explorers/commit/54f30ec))
- Path-traversal guards and EVM wei precision in providers ([ae5fb70](https://github.com/agntn/explorers/commit/ae5fb70))
- Preserve root CLI flags ([537b975](https://github.com/agntn/explorers/commit/537b975))
- Handle mempool coinbase inputs ([444eed4](https://github.com/agntn/explorers/commit/444eed4))

### 💅 Refactors

- Drop dead exports, inline helpers, simplify buildQuery ([2c77826](https://github.com/agntn/explorers/commit/2c77826))
- Drop dead core/providers.ts (unused builtinProviders export) ([59149bb](https://github.com/agntn/explorers/commit/59149bb))
- Introduce abstract provider architecture ([99387c1](https://github.com/agntn/explorers/commit/99387c1))
- ⚠️ Use explorer-backed providers ([d33b6a8](https://github.com/agntn/explorers/commit/d33b6a8))
- Rename package to explorers ([745cb64](https://github.com/agntn/explorers/commit/745cb64))

### 📖 Documentation

- Add AGENTS.md with scope, conventions, constraints ([ff25bbd](https://github.com/agntn/explorers/commit/ff25bbd))
- Add mempool provider to AGENTS.md ([a64d1d0](https://github.com/agntn/explorers/commit/a64d1d0))
- Document provider architecture and MIT license ([7de988d](https://github.com/agntn/explorers/commit/7de988d))

### 🏡 Chore

- Remove wiki ([004a6a3](https://github.com/agntn/explorers/commit/004a6a3))
- Harden package tooling and publishing ([a0f33dd](https://github.com/agntn/explorers/commit/a0f33dd))
- Update `README.md` ([06a5118](https://github.com/agntn/explorers/commit/06a5118))
- Update `AGENTS.md` ([6aff756](https://github.com/agntn/explorers/commit/6aff756))
- Add npm repository metadata ([3eb7573](https://github.com/agntn/explorers/commit/3eb7573))
- Add `changelogen` ([69e73dd](https://github.com/agntn/explorers/commit/69e73dd))
- Update `oxfmt` config ([8d60609](https://github.com/agntn/explorers/commit/8d60609))

### ✅ Tests

- Blockscout + ENS integration tests — 10/10 passing ([c7322ff](https://github.com/agntn/explorers/commit/c7322ff))
- **blocex:** ClassifyInput (7/7 PASS) ([2105dde](https://github.com/agntn/explorers/commit/2105dde))
- **blocex:** Error hierarchy (10/10 PASS) ([1d6989d](https://github.com/agntn/explorers/commit/1d6989d))

#### ⚠️ Breaking Changes

- ⚠️ Use explorer-backed providers ([d33b6a8](https://github.com/agntn/explorers/commit/d33b6a8))

### ❤️ Contributors

- Oritwoen ([@oritwoen](https://github.com/oritwoen))
