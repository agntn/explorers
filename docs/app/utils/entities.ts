import { isIdentifier } from "#shared/identifier";
import { hostPath } from "./format";
import { chainInfo, isEvm } from "./providers";

export { isIdentifier };

export type EntityKind = "address" | "tx" | "block";

/** Chains whose transaction hashes are plain hex, as `HEX_HASH_CHAINS` lists them in the library. */
const HEX_HASH_CHAINS = new Set(["bitcoin", "bitcoincash", "litecoin", "pepecoin", "ecash", "tron", "cardano", "decred", "stellar"]);

/**
 * Mirrors `classifyInput` in `src/core/input.ts`, plus a block number for input that's all digits.
 *
 * The page needs the answer before any request goes out, and the library can't be imported into
 * the browser. Arweave addresses and transaction ids share a shape and land on `address`; the
 * address page offers the transaction reading as a link.
 */
export function classify(input: string, chain: string): EntityKind {
  const value = input.trim();
  if (/^\d+$/u.test(value)) return "block";
  if (chain === "sui" && /^0x[0-9a-fA-F]{64}$/u.test(value)) return "address";
  if (HEX_HASH_CHAINS.has(chain) && /^[0-9a-fA-F]{64}$/u.test(value)) return "tx";
  if (chain === "solana" && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/u.test(value)) return "tx";
  if (chain === "sui" && /^[1-9A-HJ-NP-Za-km-z]{43,44}$/u.test(value)) return "tx";
  if (/^0x[0-9a-fA-F]{64}$/u.test(value)) return "tx";
  return "address";
}

export function addressPath(chain: string, address: string): string {
  return `/explorer/address/${encodeURIComponent(chain)}/${encodeURIComponent(address)}`;
}

export function txPath(chain: string, hash: string): string {
  return `/explorer/tx/${encodeURIComponent(chain)}/${encodeURIComponent(hash)}`;
}

export function blockPath(chain: string, number: number | string): string {
  return `/explorer/block/${encodeURIComponent(chain)}/${encodeURIComponent(String(number))}`;
}

export function entityPath(kind: EntityKind, chain: string, id: string): string {
  if (kind === "tx") return txPath(chain, id);
  if (kind === "block") return blockPath(chain, id);
  return addressPath(chain, id);
}

interface ExternalPattern {
  address?: string;
  tx?: string;
  block?: string;
}

/** Every explorer in the Etherscan shape shares these paths, so an EVM chain gets them by type. */
const EVM: ExternalPattern = { address: "/address/{id}", tx: "/tx/{id}", block: "/block/{id}" };

/** Paths on the canonical explorer from `@agntn/chains` for the chains that aren't EVM; a missing entry means no link rather than a guess. */
const EXTERNAL: Record<string, ExternalPattern> = {
  bitcoin: { address: "/address/{id}", tx: "/tx/{id}", block: "/block-height/{id}" },
  bitcoincash: { address: "/address/{id}", tx: "/transaction/{id}", block: "/block/{id}" },
  litecoin: { address: "/address/{id}", tx: "/tx/{id}", block: "/block/{id}" },
  pepecoin: { address: "/address/{id}", tx: "/tx/{id}", block: "/block/{id}" },
  ecash: { address: "/address/{id}", tx: "/tx/{id}" },
  solana: { address: "/account/{id}", tx: "/tx/{id}", block: "/block/{id}" },
  ton: { address: "/address/{id}", tx: "/tx/{id}" },
  tron: { address: "/#/address/{id}", tx: "/#/transaction/{id}", block: "/#/block/{id}" },
  aptos: { address: "/account/{id}", tx: "/txn/{id}", block: "/block/{id}" },
  sui: { address: "/mainnet/account/{id}", tx: "/mainnet/tx/{id}" },
  cardano: { address: "/address/{id}", tx: "/transaction/{id}", block: "/block/{id}" },
  arweave: { address: "/address/{id}", tx: "/tx/{id}", block: "/block/{id}" },
  decred: { address: "/address/{id}", tx: "/tx/{id}", block: "/block/{id}" },
  stellar: { address: "/account/{id}", tx: "/tx/{id}", block: "/ledger/{id}" },
};

/** The same entity on the chain's own explorer, or null when the pattern is unknown. */
export function externalUrl(kind: EntityKind, chain: string, id: string): string | null {
  const base = chainInfo(chain)?.explorer;
  const pattern = (isEvm(chain) ? EVM : EXTERNAL[chain])?.[kind];
  if (!base || !pattern) return null;
  return `${base.replace(/\/$/u, "")}${pattern.replace("{id}", encodeURIComponent(id))}`;
}

/** Host of the canonical explorer, for the link label. */
export function externalHost(chain: string): string {
  const base = chainInfo(chain)?.explorer;
  return base ? (hostPath(base).split("/")[0] ?? "") : "";
}
