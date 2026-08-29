# Provider implementations

## Scope

Concrete explorer and indexer backends. One service per TypeScript file.

## Conventions

- Extend `Provider`, own one stable `static readonly key`, and keep unsupported optional methods absent.
- Validate path segments before I/O and use inherited HTTP helpers so errors carry the provider key.
- Declare chain and endpoint metadata in `index.ts`; add each provider file to `build.config.ts`.
- Keep backend response types and mapping logic in the provider file. Share a helper only after a third real use.
- Unit tests use deterministic response stubs; live probes supplement them but do not replace them.

## Constraints

- Providers expose explorer or indexer data only. Do not hide fullnode RPC behind this layer.
- No module-load calls or registration side effects.
- Amounts stay as strings at public boundaries.
