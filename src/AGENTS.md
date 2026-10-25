# src/ — Module Organization

## Layout

```
src/
  index.ts          — Library entry: re-exports types, utilities, registry
  cli.ts            - CLI entry: `mcp` from live source in a checkout, everything else through cli-run.ts
  cli-run.ts        - runCli from @agntn/tools/cli over the tool list
  tools.ts          - One defineTool per tool, shared by MCP, Pi, OMP and the CLI
  tool-operations.ts - Executors, loaded on the first call
  tool-lines.ts     - Lines the Pi and OMP renderers draw from details
  tool-limits.ts    - Bounds the schemas and executors share, no imports
  mcp.ts            - MCP server: createMcpServer(), the @agntn/explorers/mcp entry
  version.ts        — Single version string
  core/             — Domain layer (types, registry, errors, HTTP, ENS, input)
  providers/        — Provider implementations (one file per provider)
  commands/mcp.ts   - serveMcp(), the stdio server
```

## Conventions

- **Import paths**: Relative imports end in `.ts` (`from './types.ts'`), so `node src/cli.ts` runs under plain Node type stripping. For the same reason there is no `enum`, `namespace` or parameter property; `erasableSyntaxOnly` and `NodeNext` resolution in `tsconfig.json` enforce both
- **Provider registration**: Each concrete class is exported and owns a unique static `key`. Its chains, capabilities, and public endpoint live in the `builtins` entry in `providers/index.ts` next to a `load` that imports the module, and the registry builds its map from that list on first use.
- **Side-effect-free modules**: no top-level calls. Derived state is built on demand (`entries()` in the registry, `decoder()` in mempool), and anything the registry needs about a provider lives in its `builtins` entry rather than in a computed class field.
- **Type imports**: Always `import type { ... }` for types, separate from value imports
- **Error handling**: Providers throw typed errors (`UnsupportedChainError`, `HTTPError`, etc.). Executors let them through; `@agntn/tools` turns them into an MCP error, a Pi or OMP failure, or one stderr line with exit code 1.

## Key contracts

- `Provider` - abstract base class all providers extend. Each concrete class owns a static `key`; the inherited instance `name` reads it. Registry metadata lives in `builtins`, not on the class. Required getter: `capabilities`. Required methods: `getBalance()`, `getTxHistory()`. Optional: `getTxDetail()`, `getUtxos()`, `getPubkey()`, `getContractInfo()`, `getTokenBalances()`, `getTokenTransfers()`, `getGasData()`, `getBlockInfo()`.
- `ProviderCapabilities` — boolean flags for what a provider supports
- `ProviderConfig` - `{ apiKey?, baseUrl?, timeout?, defaultChain?, signal? }`

## Anti-patterns

- Adding a new provider without matching chains and capabilities in `builtins`
- Computing a static class field or module constant with a call at load time instead of a lazy helper
- Calling optional methods without `requireOperation()`, which checks both `capabilities` and method presence
- Using `process.exit()` in library code
