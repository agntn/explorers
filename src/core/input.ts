/** Address/input resolution — ENS names, raw addresses, tx hashes. */
import { getChain, identify } from "@agntn/chains";
import type { Chain } from "@agntn/chains";
import { AddressChainMismatchError, NotFoundError } from "./errors.ts";
import type { ChainKey } from "./types.ts";
import { isEnsName, isAddress, resolveEns } from "./ens.ts";
import { providers, supportsChain } from "./registry.ts";

export type InputType = "address" | "txhash" | "ens";

const HEX_HASH_CHAINS: readonly ChainKey[] = [
  "bitcoin",
  "bitcoincash",
  "bitcoinsv",
  "litecoin",
  "pepecoin",
  "ecash",
  "tron",
  "cardano",
  "decred",
  "stellar",
];

function isChainTransactionHash(input: string, chain?: ChainKey): boolean {
  if (chain !== undefined && HEX_HASH_CHAINS.includes(chain))
    return /^[0-9a-fA-F]{64}$/.test(input);
  if (chain === "solana") return /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(input);
  return chain === "sui" && /^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(input);
}

/**
 * Classify raw user input, using chain-specific hash shapes where unambiguous.
 *
 * @param {string} input - The `input` value.
 * @param {ChainKey} chain - The `chain` value.
 * @returns {InputType} The resulting value.
 */
export function classifyInput(input: string, chain?: ChainKey): InputType {
  const trimmed = input.trim();
  if (chain === "sui" && /^0x[0-9a-fA-F]{64}$/.test(trimmed)) return "address";
  if (isChainTransactionHash(trimmed, chain)) return "txhash";
  if (/^0x[0-9a-fA-F]{64}$/.test(trimmed)) return "txhash";
  if (isEnsName(trimmed)) return "ens";
  if (isAddress(trimmed)) return "address";
  return "address";
}

/* oxlint-disable-next-line typescript/prefer-readonly-parameter-types */
function accepts(chain: Chain, address: string): boolean {
  try {
    chain.assertAddress(address);
    return true;
  } catch {
    return false;
  }
}

/* An address the requested chain rejects travels on to the provider unless its format names another
 * chain family. Chains share formats within a family, such as Bitcoin P2SH on Litecoin or legacy
 * base58 on eCash, and explorers accept forms the validators do not know, such as raw TON or hex
 * TRON, so only a cross-family match is proof that the request cannot succeed. */
function assertChainFamily(address: string, chain: ChainKey): void {
  const expected = getChain(chain);
  if (!expected.validatesAddress || accepts(expected, address)) return;
  const { matches } = identify(address);
  if (matches.length === 0 || matches.some((match) => match.type === expected.type)) return;
  throw new AddressChainMismatchError(
    address,
    chain,
    matches.map((match) => match.key),
  );
}

function served(chain: ChainKey): boolean {
  return providers().some((name) => supportsChain(name, chain));
}

/* Forks that kept the address format of the chain they split from. An address both accept reads
 * as the original chain, where far more of them live, unless the caller names the fork. */
const FORK_OF: Partial<Record<ChainKey, ChainKey>> = { bitcoinsv: "bitcoin" };

/* Chains share formats across forks: a legacy Bitcoin address is a valid Bitcoin SV one too. The
 * chains a named provider serves come first, then the chains any provider serves, and a fork gives
 * way to the chain it took the format from. */
function chainOf(input: string, provider?: string): ChainKey | undefined {
  const trimmed = input.trim();
  if (classifyInput(trimmed) !== "address") return undefined;
  const keys = identify(trimmed).matches.map((match) => match.key);
  if (keys.length < 2) return keys[0];
  const byProvider =
    provider === undefined ? [] : keys.filter((key) => supportsChain(provider, key));
  const candidates = byProvider.length > 0 ? byProvider : keys.filter(served);
  const originals = candidates.filter((key) => {
    const original = FORK_OF[key];
    return original === undefined || !candidates.includes(original);
  });
  return originals.length === 1 ? originals[0] : undefined;
}

/**
 * Name the chain an address belongs to when its format admits exactly one, or when a provider
 * serves only one of the chains it admits. A legacy Bitcoin address fits Bitcoin SV as well and
 * reads as Bitcoin, unless `provider` serves Bitcoin SV alone. EVM addresses match every EVM chain
 * and stay unresolved, as do ENS names, transaction hashes and unknown formats. A list resolves only
 * when every entry names the same chain.
 *
 * @throws {TypeError} When a serialized tool list falls outside its input contract.
 *
 * @param {string | readonly string[] | undefined} input - One address or an address list.
 * @param {string} [provider] - Provider the read is pinned to, whose chains win a shared format.
 * @returns {ChainKey | undefined} The one chain the input names, if there is one.
 */
export function inferChain(
  input: string | readonly string[] | undefined,
  provider?: string,
): ChainKey | undefined {
  if (input === undefined) return undefined;
  const list = typeof input === "string" ? (parseSerializedAddressList(input) ?? [input]) : input;
  const chains = new Set(list.map((entry) => chainOf(entry, provider)));
  const [chain] = chains;
  return chains.size === 1 ? chain : undefined;
}

/**
 * Classify an input and resolve ENS names. Addresses and transaction hashes pass through unchanged.
 *
 * @throws {NotFoundError} When an ENS name cannot be resolved.
 * @throws {AddressChainMismatchError} When the address format belongs to another chain family.
 *
 * @param {string} input - The `input` value.
 * @param {ChainKey} chain - The `chain` value.
 * @returns {Promise<{ address: string; type: InputType }>} The resulting value.
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
    if (chain !== undefined) assertChainFamily(trimmed, chain);
    return { address: trimmed, type };
  }

  const resolved = await resolveEns(trimmed);
  if (!resolved) {
    throw new NotFoundError(`ENS name ${trimmed}`);
  }
  return { address: resolved, type };
}

const MAX_TOOL_ADDRESS_BATCH = 20;

function parseSerializedAddressList(input: string): readonly string[] | undefined {
  const trimmed = input.trim();
  if (!trimmed.startsWith("[")) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }

  if (!Array.isArray(parsed)) return undefined;
  if (
    parsed.length === 0 ||
    parsed.length > MAX_TOOL_ADDRESS_BATCH ||
    !parsed.every(
      (item: unknown): item is string => typeof item === "string" && item.trim().length > 0,
    )
  ) {
    throw new TypeError("Address list must contain 1 to 20 nonblank strings");
  }
  return parsed;
}

/**
 * Resolve one address or an address list, including lists serialized by a tool host.
 *
 * @throws {NotFoundError} When any ENS name cannot be resolved.
 * @throws {AddressChainMismatchError} When an address format belongs to another chain family.
 * @throws {TypeError} When a serialized tool list falls outside its input contract.
 *
 * @param {string | readonly string[]} input - The `input` value.
 * @param {ChainKey} chain - The `chain` value.
 * @returns {Promise<string[]>} The resulting value.
 */
export async function resolveAddresses(
  input: string | readonly string[],
  chain?: ChainKey,
): Promise<string[]> {
  const list = typeof input === "string" ? (parseSerializedAddressList(input) ?? [input]) : input;
  const resolved = await Promise.all(list.map((item) => resolveInput(item, chain)));
  return resolved.map((entry) => entry.address);
}
