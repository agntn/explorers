# src/ — Module Organization

## Layout

```
src/
  index.ts          — Library entry: re-exports types, utilities, registry
  cli.ts            — CLI entry: citty main, lazy subcommand imports
  cli-args.ts       — Arg normalization (bare address → balance subcommand)
  version.ts        — Single version string
  core/             — Domain layer (types, registry, errors, HTTP, ENS, input)
  providers/        — Provider implementations (one file per provider)
  commands/         — CLI subcommands (one file per command)
```

## Conventions

- **Import paths**: Always use `.js` extension (`from './types.js'`) — ESM with Bundler resolution
- **Provider registration**: Each concrete class owns a unique static `providerName` and passes itself to `register()` at module scope. Barrel `providers/index.ts` imports all.
- **Command pattern**: Each command exports a `defineCommand()` result as default export
- **Type imports**: Always `import type { ... }` for types, separate from value imports
- **Error handling**: Providers throw typed errors (`UnsupportedChainError`, `HTTPError`, etc.). Commands catch and `process.exit(1)`.

## Key contracts

- `Provider` — abstract base class all providers extend. Each concrete class owns a static `providerName` and exposes it as readonly instance `name`. Required getter: `capabilities`. Required methods: `getBalance()`, `getTxHistory()`. Optional: `getTxDetail()`, `getContractInfo()`, `getTokenBalances()`, `getGasData()`, `getBlockInfo()`.
- `ProviderCapabilities` — boolean flags for what a provider supports
- `ProviderConfig` — `{ apiKey?, baseUrl?, timeout?, defaultChain? }`

## Anti-patterns

- Adding a new provider without updating `providers/index.ts` barrel
- Calling optional methods without checking both `capabilities` and method presence
- Using `process.exit()` in library code (only in commands)
