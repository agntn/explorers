/** Address/input resolution — ENS names, raw addresses, tx hashes. */
import { NotFoundError } from "./errors.js";
import type { ChainKey } from "./types.js";
import { isEnsName, isAddress, resolveEns } from "./ens.js";

export type InputType = "address" | "txhash" | "ens";

/** Classify raw user input, using chain-specific hash shapes where unambiguous. */
export function classifyInput(input: string, chain?: ChainKey): InputType {
  const trimmed = input.trim();
  if (chain === "sui" && /^0x[0-9a-fA-F]{64}$/.test(trimmed)) return "address";
  if (
    ((chain === "bitcoin" ||
      chain === "litecoin" ||
      chain === "ecash" ||
      chain === "tron" ||
      chain === "cardano") &&
      /^[0-9a-fA-F]{64}$/.test(trimmed)) ||
    (chain === "solana" && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(trimmed)) ||
    (chain === "sui" && /^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(trimmed))
  ) {
    return "txhash";
  }
  if (/^0x[0-9a-fA-F]{64}$/.test(trimmed)) return "txhash";
  if (isEnsName(trimmed)) return "ens";
  if (isAddress(trimmed)) return "address";
  return "address";
}

/**
 * Classify an input and resolve ENS names. Addresses and transaction hashes pass through unchanged.
 *
 * @throws {NotFoundError} When an ENS name cannot be resolved.
 */
export async function resolveInput(
  input: string,
  chain?: ChainKey,
): Promise<{ address: string; type: InputType }> {
  const trimmed = input.trim();
  const type = classifyInput(trimmed, chain);

  if (type === "txhash") {
    return { address: trimmed, type };
  }

  if (type === "address") {
    return { address: trimmed, type };
  }

  const resolved = await resolveEns(trimmed);
  if (!resolved) {
    throw new NotFoundError(`ENS name ${trimmed}`);
  }
  return { address: resolved, type };
}

/**
 * Resolve one address or a list of addresses, preserving order.
 *
 * @throws {NotFoundError} When any ENS name cannot be resolved.
 */
export async function resolveAddresses(
  input: string | readonly string[],
  chain?: ChainKey,
): Promise<string[]> {
  const list = typeof input === "string" ? [input] : input;
  const resolved = await Promise.all(list.map((item) => resolveInput(item, chain)));
  return resolved.map((entry) => entry.address);
}
