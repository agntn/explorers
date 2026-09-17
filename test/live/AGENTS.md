# Live test scope

## Scope

Manual roundtrips against public explorer APIs. Not part of `pnpm test`, `pnpm test:run`, release, or publish CI.

## Conventions

- Run with `pnpm test:live`.
- Assert shape, not drifting amounts.
- Keep timeouts on the cases that wait on a public instance.
