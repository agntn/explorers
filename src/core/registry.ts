/**
 * Self-registering provider registry for blocex
 */

import type { BlocexProvider, ProviderConfig } from './types.js'
type ProviderFactory = (config: ProviderConfig) => BlocexProvider
import { UnknownProviderError } from './errors.js'

interface RegistryEntry {
  defaultURL?: string
  factory: ProviderFactory
}

const factories = new Map<string, RegistryEntry>()

export function register(name: string, factory: ProviderFactory, defaultURL?: string): void {
  factories.set(name, { defaultURL, factory })
}

export function create(name: string, config?: ProviderConfig): BlocexProvider {
  const entry = factories.get(name)
  if (!entry) {
    throw new UnknownProviderError(name)
  }
  return entry.factory(config ?? {})
}

export function providers(): string[] {
  return Array.from(factories.keys())
}

export function has(name: string): boolean {
  return factories.has(name)
}

export function getDefaultURL(name: string): string | undefined {
  return factories.get(name)?.defaultURL
}
