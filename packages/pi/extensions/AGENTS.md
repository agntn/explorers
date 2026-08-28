# Pi extension scope

## Scope

This directory contains the Pi extension entry point distributed with `@agntn/explorers`.

## Conventions

- Prefer live `src/` in a repository checkout and `dist/` in an installed package.
- Resolve runtime modules relative to the extension file. Do not import the package by its own bare name from its extension.
- Keep library loading lazy and cache only a successful module promise.
- Tool behavior delegates to the library and must remain covered by `test/unit/pi-extension.test.ts`.
- Sanitize untrusted explorer text before rendering it in the terminal.
