# Core provider runtime

## Scope

Shared provider contracts, registry metadata, selection, HTTP transport, errors, ENS, and input handling.

## Conventions

- Registry chain and capability metadata must stay answerable without importing provider modules.
- Explicit provider choices remain strict; automatic routing filters by requested chain and capability before using documented fallback rules.
- HTTP requests go through `Provider` helpers and the shared client so timeouts, integer parsing, redaction, and typed errors stay consistent.
- Public amount fields use strings. Optional provider operations stay absent at runtime when unsupported.
- Changes to exported contracts require an impact pass across CLI, MCP, Pi, OMP, tests, and README.

## Constraints

- No provider-specific response mapping in core.
- No module-load network calls or eagerly built mutable registries.
- Preserve exact provider attribution on every surfaced error.
