# OMP extension scope

## Scope

This directory contains the OMP extension entry point distributed with `@agntn/explorers`.

## Conventions

- Prefer live `src/` in a repository checkout and the sibling `dist/` in an installed package.
- Keep both dynamic import specifiers literal so OMP can resolve dependencies inside the selected graph. TypeScript resolves the sibling `dist/` specifier, so `pnpm typecheck` builds before checking types.
- Resolve runtime modules relative to the extension file instead of importing this package by its bare name.
- Keep library loading lazy and cover both loader branches in `test/unit/omp-extension.test.ts`.
- Use the OMP APIs the host injects (`pi.pi.Text`, `pi.typebox`) and draw results through `terminalLines()`, which sanitizes untrusted explorer text.
- OMP fills every schema property. It drops a `""` from a field with `minLength` before the call, so optional names take `minLength: 1`, and it refuses a number below `minimum`, so optional counts take `minimum: 0` and the executor reads `0` as left out.
