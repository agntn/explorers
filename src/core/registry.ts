/** Self-registering provider registry for Explorers */

import { Provider } from "./provider.js";
import type { ProviderConstructor } from "./provider.js";
import type { ProviderConfig } from "./types.js";
import { UnknownProviderError } from "./errors.js";

interface RegistryEntry {
  defaultURL?: string;
  providerClass: ProviderConstructor;
}

const registry = new Map<string, RegistryEntry>();

/**
 * Register a provider class under its stable `key`.
 *
 * Registering the same name again replaces the previous entry. That is useful in tests, but easy to
 * do by accident in application code.
 */
export function register(providerClass: ProviderConstructor, defaultURL?: string): void {
  registry.set(providerClass.key, { defaultURL, providerClass });
}

/**
 * Create a registered provider with optional backend configuration.
 *
 * @example
 *   ```ts
 *   import { create } from "@agntn/explorers";
 *
 *   const provider = create("blockscout");
 *   const balance = await provider.getBalance("0x0000000000000000000000000000000000000000", "eth");
 *   ```
 *
 * @throws {UnknownProviderError} When `name` has not been registered.
 */
export function create(name: string, config?: ProviderConfig): Provider {
  const entry = registry.get(name);
  if (!entry) {
    throw new UnknownProviderError(name);
  }
  return new entry.providerClass(config ?? {});
}

/** Return registered provider names in registration order. */
export function providers(): string[] {
  return Array.from(registry.keys());
}

/** Check whether a name can be passed to `create`. */
export function has(name: string): boolean {
  return registry.has(name);
}

/**
 * Return the public endpoint advertised when a provider was registered.
 *
 * Per-instance `baseUrl` overrides are deliberately not reflected here.
 */
export function getDefaultURL(name: string): string | undefined {
  return registry.get(name)?.defaultURL;
}
