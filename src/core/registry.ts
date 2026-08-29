/** Provider registry for Explorers, built from the built-in list on first use */

import { builtins } from "../providers/index.js";
import { Provider } from "./provider.js";
import type { ProviderCapability, ProviderConstructor, ProviderMeta } from "./provider.js";
import type { ChainKey, ProviderConfig } from "./types.js";
import { UnknownProviderError } from "./errors.js";

interface RegistryEntry extends ProviderMeta {
  load: () => Promise<ProviderConstructor>;
  providerClass?: ProviderConstructor;
  providerClassPromise?: Promise<ProviderConstructor>;
}

let registry: Map<string, RegistryEntry> | undefined;

/*
 * Return the registry map, filling it with the built-in metadata on the first call.
 *
 * Only the metadata lands here. Provider modules stay unloaded until `create()` asks for one, so a
 * bundle that lists or resolves providers never pulls in ten explorer clients.
 */
function entries(): Map<string, RegistryEntry> {
  registry ??= new Map(
    builtins.map(({ key, chains, capabilities, defaultURL, load }): [string, RegistryEntry] => [
      key,
      { chains, capabilities, defaultURL, load },
    ]),
  );
  return registry;
}

/**
 * Register a provider class under its stable `key`.
 *
 * Built-in providers are already registered; this is the entry point for classes living outside the
 * package, and their class is kept as is instead of being loaded on demand. Registering the same
 * name again replaces the previous entry. That is useful in tests, but easy to do by accident in
 * application code.
 *
 * @param {ProviderConstructor} providerClass - The `providerClass` value.
 * @param {Readonly<ProviderMeta>} meta - The `meta` value.
 */
export function register(providerClass: ProviderConstructor, meta: Readonly<ProviderMeta>): void {
  entries().set(providerClass.key, {
    chains: meta.chains,
    capabilities: meta.capabilities,
    defaultURL: meta.defaultURL,
    load: () => Promise.resolve(providerClass),
    providerClass,
  });
}

/**
 * Create a registered provider with optional backend configuration.
 *
 * The first call for a built-in provider imports its module; later calls reuse the loaded class.
 *
 * @example
 *   ```ts
 *   import { create } from "@agntn/explorers";
 *
 *   const provider = await create("blockscout");
 *   const balance = await provider.getBalance("0x0000000000000000000000000000000000000000", "ethereum");
 *   ```
 *
 * @throws {UnknownProviderError} When `name` has not been registered.
 *
 * @param {string} name - The `name` value.
 * @param {Readonly<ProviderConfig>} config - The `config` value.
 * @returns {Promise<Provider>} The resulting value.
 */
export async function create(name: string, config?: Readonly<ProviderConfig>): Promise<Provider> {
  const entry = entries().get(name);
  if (!entry) {
    throw new UnknownProviderError(name);
  }
  if (!entry.providerClass) {
    entry.providerClassPromise ??= entry.load();
    try {
      entry.providerClass = await entry.providerClassPromise;
    } catch (error) {
      entry.providerClassPromise = undefined;
      throw error;
    }
  }
  return new entry.providerClass(config ?? {});
}

/**
 * Return registered provider names in registration order.
 *
 * @returns {string[]} The resulting value.
 */
export function providers(): string[] {
  return Array.from(entries().keys());
}

/**
 * Check whether a name can be passed to `create`.
 *
 * @param {string} name - The `name` value.
 * @returns {boolean} The resulting value.
 */
export function has(name: string): boolean {
  return entries().has(name);
}

/**
 * Check whether a registered provider declares support for `chain`.
 *
 * @param {string} name - The `name` value.
 * @param {ChainKey} chain - The `chain` value.
 * @returns {boolean} The resulting value.
 */
export function supportsChain(name: string, chain: ChainKey): boolean {
  const entry = entries().get(name);
  return entry !== undefined && entry.chains.includes(chain);
}

/**
 * Check whether a registered provider declares support for `capability`.
 *
 * External registrations without capability metadata remain eligible so adding this routing hint
 * does not silently remove existing providers from auto-selection.
 *
 * @param {string} name - The `name` value.
 * @param {ProviderCapability} capability - The required operation.
 * @returns {boolean} Whether the provider can be considered for the operation.
 */
export function supportsCapability(name: string, capability: ProviderCapability): boolean {
  const entry = entries().get(name);
  return entry !== undefined && (entry.capabilities?.includes(capability) ?? true);
}

/**
 * Return the public endpoint advertised for a provider.
 *
 * Per-instance `baseUrl` overrides are deliberately not reflected here.
 *
 * @param {string} name - The `name` value.
 * @returns {string | undefined} The resulting value.
 */
export function getDefaultURL(name: string): string | undefined {
  return entries().get(name)?.defaultURL;
}
