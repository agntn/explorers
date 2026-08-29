import consola from "consola";
import type { Provider } from "../core/provider.js";
import { create } from "../core/registry.js";
import { PROVIDER_DEFAULT_CHAIN, resolveProvider } from "../core/resolve.js";
import { normalizeChain } from "../core/types.js";
import type { ChainKey } from "../core/types.js";

export interface SelectedProvider {
  readonly chain: ChainKey;
  readonly name: string;
  readonly provider: Provider;
}

export async function selectProvider(
  chainInput: string | undefined,
  providerInput: string | undefined,
): Promise<SelectedProvider> {
  const requestedChain = chainInput === undefined ? undefined : normalizeChain(chainInput);
  const name = resolveProvider(providerInput, requestedChain);
  const provider = await create(name);
  const chain = requestedChain ?? normalizeChain(PROVIDER_DEFAULT_CHAIN[name]);
  return { chain, name, provider };
}

export function failCommand(message: string): never {
  consola.error(message);
  process.exit(1);
}

function parseInteger(value: string, message: string, minimum: number): number {
  const text = value.trim();
  const number = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(number) || number < minimum)
    failCommand(message);
  return number;
}

export function parseNonNegativeInteger(value: string, message: string): number {
  return parseInteger(value, message, 0);
}

export function parsePositiveInteger(value: string, message: string): number {
  return parseInteger(value, message, 1);
}

export function reportCommandError(error: unknown): never {
  consola.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
