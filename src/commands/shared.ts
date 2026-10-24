import consola from "consola";
import type { Provider, ProviderCapability, ProviderOperation } from "../core/provider.ts";
import type { ChainKey } from "../core/types.ts";

export interface SelectedProvider {
  readonly chain: ChainKey;
  readonly name: string;
  readonly provider: Provider;
}

export async function withSelectedProvider<T>(
  chainInput: string | undefined,
  providerInput: string | undefined,
  capability: ProviderCapability,
  /* oxlint-disable-next-line typescript/prefer-readonly-parameter-types */
  run: (selected: SelectedProvider) => Promise<T>,
  input?: string,
): Promise<T> {
  const [{ withProvider }, { normalizeChain }] = await Promise.all([
    import("../core/resolve.ts"),
    import("../core/types.ts"),
  ]);
  const requestedChain = chainInput === undefined ? undefined : normalizeChain(chainInput);
  return withProvider(providerInput, requestedChain, run, capability, input);
}

/**
 * `requireOperation()` loaded on demand; its refusal picks up the same `; try …` hint MCP gives.
 *
 * @param {Provider} provider - The provider that ran.
 * @param {K} operation - The optional method the read needs.
 * @returns {Promise<NonNullable<Provider[K]>>} The method, bound to `provider`.
 */
export async function loadOperation<K extends ProviderOperation>(
  /* oxlint-disable-next-line typescript/prefer-readonly-parameter-types */
  provider: Provider,
  operation: K,
): Promise<NonNullable<Provider[K]>> {
  const { requireOperation } = await import("../core/provider.ts");
  return requireOperation(provider, operation);
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

// oxlint-disable-next-line no-control-regex -- Terminal control bytes are precisely what this boundary removes.
const TERMINAL_CONTROLS = /[\u0000-\u0008\u000A-\u001F\u007F-\u009F\u2028\u2029]/gu;

/**
 * Print one result line. A token symbol, a contract name or a decoded method is text a stranger
 * chose, so the control bytes a terminal would obey are dropped, and every line break with them,
 * since a field that breaks the line poses as the next result line. Only tab survives.
 *
 * @param {string} line - One line of a result, as the renderer composed it.
 */
export function print(line: string): void {
  consola.log(line.replace(TERMINAL_CONTROLS, ""));
}
