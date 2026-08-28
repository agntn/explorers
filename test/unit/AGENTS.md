# Unit test scope

## Scope

Focused Vitest coverage for core contracts, providers, commands, and extension integration.

## Conventions

- Assert observable behavior through real module seams.
- Keep tests deterministic and offline unless a test is explicitly marked as live.
- Restore globals, environment values, caches, and temporary resources in the same test lifecycle that changes them.
- Run the focused file first, then the full suite when module or process state may leak.
