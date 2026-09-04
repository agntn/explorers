# OMP extension scope

## Scope

This directory contains the OMP extension entry point distributed with `@agntn/explorers`.

## Conventions

- Prefer live `src/` in a repository checkout and the sibling `dist/` in an installed package.
- Keep both dynamic import specifiers literal so OMP can resolve dependencies inside the selected graph. TypeScript resolves the sibling `dist/` specifier, so `pnpm typecheck` builds before checking types.
- Resolve runtime modules relative to the extension file instead of importing this package by its bare name.
- Keep library loading lazy and cover both loader branches in `test/unit/omp-extension.test.ts`.
- Use host-injected OMP APIs and sanitize untrusted explorer text before terminal rendering.
