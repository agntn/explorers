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
- **Provider registration**: Each concrete class is exported and owns a unique static `key`. Its chains and public endpoint live in the `builtins` entry in `providers/index.ts` next to a `load` that imports the module, and the registry builds its map from that list on first use.
- **Side-effect-free modules**: no top-level calls. Derived state is built on demand, and class metadata that needs a call (`Object.keys(CHAIN_BASES)`) is exposed as `static get chains()` so evaluating the class stays free.
- **Command pattern**: Each command exports a `defineCommand()` result as default export
- **Type imports**: Always `import type { ... }` for types, separate from value imports
- **Error handling**: Providers throw typed errors (`UnsupportedChainError`, `HTTPError`, etc.). Commands catch and `process.exit(1)`.

## Key contracts

- `Provider` - abstract base class all providers extend. Each concrete class owns a static `key`; the inherited instance `name` reads it. Registry metadata lives in `builtins`, not on the class. Required getter: `capabilities`. Required methods: `getBalance()`, `getTxHistory()`. Optional: `getTxDetail()`, `getContractInfo()`, `getTokenBalances()`, `getTokenTransfers()`, `getGasData()`, `getBlockInfo()`.
- `ProviderCapabilities` — boolean flags for what a provider supports
- `ProviderConfig` — `{ apiKey?, baseUrl?, timeout?, defaultChain? }`

## Anti-patterns

- Adding a new provider without an entry in `builtins` or an input in `build.config.ts`
- Computing a static class field or module constant with a call at load time instead of a getter or a lazy helper
- Calling optional methods without checking both `capabilities` and method presence
- Using `process.exit()` in library code (only in commands)
