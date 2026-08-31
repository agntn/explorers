import consola from "consola";
import type { Provider, ProviderCapability } from "../core/provider.js";
import { withProvider } from "../core/resolve.js";
import { normalizeChain } from "../core/types.js";
import type { ChainKey } from "../core/types.js";

export interface SelectedProvider {
  readonly chain: ChainKey;
  readonly name: string;
  readonly provider: Provider;
}

export function withSelectedProvider<T>(
  chainInput: string | undefined,
  providerInput: string | undefined,
  capability: ProviderCapability,
  /* oxlint-disable-next-line typescript/prefer-readonly-parameter-types */
  run: (selected: SelectedProvider) => Promise<T>,
): Promise<T> {
  const requestedChain = chainInput === undefined ? undefined : normalizeChain(chainInput);
  return withProvider(providerInput, requestedChain, run, capability);
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
