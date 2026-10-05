import { assertSafePathSegment } from "./path-safety.ts";
import { formatWei, toTimestamp } from "./types.ts";
import type { PubkeyReveal, Utxo } from "./types.ts";

const CHAIN_PAGE_SIZE = 25;

/** A history read walks at most this many rows, 40 confirmed pages, to reach its page. */
export const ESPLORA_HISTORY_ROWS = 1000;

/** Every Esplora backend served here counts in satoshi-sized units. */
const ESPLORA_DECIMALS = 8;

interface EsploraAddressTransaction {
  txid: string;
  status: { confirmed: boolean };
}

interface EsploraOutput {
  readonly scriptpubkey_address?: string;
  readonly scriptpubkey_type: string;
  readonly value: number | string;
}

export interface EsploraUnspentOutput {
  readonly txid: string;
  readonly vout: number;
  readonly value: number | string;
  readonly status: {
    readonly confirmed: boolean;
    readonly block_height?: number;
    readonly block_hash?: string;
    readonly block_time?: number;
  };
}

function mapEsploraUtxo(raw: Readonly<EsploraUnspentOutput>): Utxo {
  const value = String(raw.value);
  return {
    txid: raw.txid,
    vout: raw.vout,
    value,
    valueFormatted: formatWei(value, ESPLORA_DECIMALS),
    confirmed: raw.status.confirmed,
    blockNumber: raw.status.block_height ?? null,
    blockHash: raw.status.block_hash ?? null,
    timestamp: raw.status.block_time ? toTimestamp(raw.status.block_time) : undefined,
  };
}

/**
 * Fetch the unspent outputs of an Esplora address, in the order the backend lists them.
 *
 * @param {string} address - The `address` value.
 * @param {(path: string) => Promise<readonly EsploraUnspentOutput[]>} fetchUtxos - Read one
 *   provider path.
 * @returns {Promise<Utxo[]>} The resulting value.
 */
export async function getEsploraUtxos(
  address: string,
  fetchUtxos: (path: string) => Promise<readonly EsploraUnspentOutput[]>,
): Promise<Utxo[]> {
  assertSafePathSegment(address, "address");
  const outputs = await fetchUtxos(`/api/address/${encodeURIComponent(address)}/utxo`);
  return outputs.map(mapEsploraUtxo);
}

function confirmedHistoryPath(encodedAddress: string, encodedCursor: string): string {
  return `/api/address/${encodedAddress}/txs/chain/${encodedCursor}`;
}

/**
 * Choose the first non-OP_RETURN output, optionally excluding an address from recipient selection.
 *
 * @param {readonly EsploraOutput[]} outputs - Transaction outputs in provider order.
 * @param {string} [excludedAddress] - Address whose own outputs should not win when another
 *   non-OP_RETURN output exists.
 * @returns {Readonly<{ address: string | null; value: number | string }>} The selected output pair.
 */
export function selectEsploraRecipientOutput(
  outputs: readonly EsploraOutput[],
  excludedAddress?: string,
): Readonly<{ address: string | null; value: number | string }> {
  const firstTransfer = outputs.find((candidate) => candidate.scriptpubkey_type !== "op_return");
  const output =
    (excludedAddress === undefined
      ? firstTransfer
      : outputs.find(
          (candidate) =>
            candidate.scriptpubkey_type !== "op_return" &&
            candidate.scriptpubkey_address !== excludedAddress,
        )) ??
    firstTransfer ??
    outputs[0];

  return {
    address: output?.scriptpubkey_address ?? null,
    value: output?.value ?? 0,
  };
}

/* Yield the address feed page by page, newest first, following the cursor of confirmed rows. */
async function* esploraHistoryPages<T extends EsploraAddressTransaction>(
  address: string,
  fetchPage: (path: string) => Promise<T[]>,
  nextPagePath: (encodedAddress: string, encodedCursor: string) => string,
): AsyncGenerator<T[]> {
  assertSafePathSegment(address, "address");
  const encodedAddress = encodeURIComponent(address);
  const firstPage = await fetchPage(`/api/address/${encodedAddress}/txs`);
  yield firstPage;
  let cursor = firstPage.findLast((transaction) => transaction.status.confirmed)?.txid;

  while (cursor !== undefined) {
    const page = await fetchPage(nextPagePath(encodedAddress, encodeURIComponent(cursor)));
    const nextCursor = page.at(-1)?.txid;
    if (nextCursor === undefined || nextCursor === cursor) return;

    yield page;
    if (page.length < CHAIN_PAGE_SIZE) return;
    cursor = nextCursor;
  }
}

/**
 * Fetch one page of an Esplora address feed, walking the confirmed-chain cursor past earlier rows.
 *
 * @param {string} address - The `address` value.
 * @param {Readonly<{ limit: number; offset: number }>} window - Rows to return and to skip first.
 * @param {(path: string) => Promise<T[]>} fetchPage - The `fetchPage` value.
 * @param {(encodedAddress: string, encodedCursor: string) => string} nextPagePath - Build the
 *   provider-specific confirmed-history cursor path.
 * @returns {Promise<T[]>} The resulting value.
 */
export async function getEsploraAddressHistory<T extends EsploraAddressTransaction>(
  address: string,
  window: Readonly<{ limit: number; offset: number }>,
  fetchPage: (path: string) => Promise<T[]>,
  nextPagePath: (encodedAddress: string, encodedCursor: string) => string = confirmedHistoryPath,
): Promise<T[]> {
  const limit = window.offset + window.limit;
  const transactions: T[] = [];

  for await (const page of esploraHistoryPages(address, fetchPage, nextPagePath)) {
    transactions.push(...page.slice(0, limit - transactions.length));
    if (transactions.length >= limit) break;
  }

  return transactions.slice(window.offset);
}

/** A compressed or uncompressed secp256k1 key as hex. */
const SEC_PUBKEY = /^(?:0[23][0-9a-f]{64}|04[0-9a-f]{128})$/i;

/** A segwit v1 output script, whose 32-byte program is the taproot output key. */
const TAPROOT_SCRIPT = /^5120([0-9a-f]{64})$/i;

/** A segwit address of the chains served here, whose feed rows spell it in lowercase. */
const SEGWIT_ADDRESS = /^(?:bc|tb|bcrt|ltc|tltc|rltc)1/i;

/** The redeem script of P2SH-wrapped P2WPKH, which leaves the key in the witness. */
const NESTED_P2WPKH = /^OP_0 OP_PUSHBYTES_20 [0-9a-f]{40}$/i;

interface EsploraKeyOutput {
  readonly scriptpubkey: string;
  readonly scriptpubkey_type: string;
  readonly scriptpubkey_address?: string;
}

interface EsploraKeyInput {
  readonly txid: string;
  readonly prevout: EsploraKeyOutput | null;
  readonly scriptsig_asm?: string;
  readonly inner_redeemscript_asm?: string;
  readonly witness?: readonly string[];
}

/** An address feed row with the scripts a key can hide in. */
export interface EsploraKeyTransaction {
  readonly txid: string;
  readonly status: { readonly confirmed: boolean };
  readonly vin: readonly EsploraKeyInput[];
  readonly vout: readonly EsploraKeyOutput[];
}

/** The spend counters of `/api/address/:address`. */
export interface EsploraAddressStats {
  readonly chain_stats: { readonly spent_txo_count: number; readonly tx_count: number };
  readonly mempool_stats?: { readonly spent_txo_count: number; readonly tx_count: number };
}

type KeySighting = Pick<PubkeyReveal, "pubkey" | "source" | "txid">;

function secKey(candidate: string | undefined): string | undefined {
  return candidate !== undefined && SEC_PUBKEY.test(candidate)
    ? candidate.toLowerCase()
    : undefined;
}

function taprootKey(scriptpubkey: string): string | undefined {
  return TAPROOT_SCRIPT.exec(scriptpubkey)?.[1]?.toLowerCase();
}

/* Consensus ties the key to the address: a spend whose key hashed elsewhere never confirmed. */
function spentKey(input: Readonly<EsploraKeyInput>, type: string): string | undefined {
  if (type === "p2pkh") return secKey(input.scriptsig_asm?.split(" ").at(-1));
  if (type === "v0_p2wpkh") return secKey(input.witness?.[1]);
  if (type === "p2sh" && NESTED_P2WPKH.test(input.inner_redeemscript_asm ?? "")) {
    return secKey(input.witness?.[1]);
  }
  return undefined;
}

function inputSighting(input: Readonly<EsploraKeyInput>, txid: string): KeySighting | undefined {
  const prevout = input.prevout;
  if (prevout === null) return undefined;

  const outputKey = taprootKey(prevout.scriptpubkey);
  if (prevout.scriptpubkey_type === "v1_p2tr" && outputKey !== undefined) {
    return { pubkey: outputKey, source: "output", txid: input.txid };
  }
  const pubkey = spentKey(input, prevout.scriptpubkey_type);
  return pubkey === undefined ? undefined : { pubkey, source: "spend", txid };
}

function sighting(
  transaction: Readonly<EsploraKeyTransaction>,
  address: string,
): KeySighting | undefined {
  for (const input of transaction.vin) {
    if (input.prevout?.scriptpubkey_address !== address) continue;
    const found = inputSighting(input, transaction.txid);
    if (found !== undefined) return found;
  }

  for (const output of transaction.vout) {
    if (output.scriptpubkey_address !== address || output.scriptpubkey_type !== "v1_p2tr") continue;
    const pubkey = taprootKey(output.scriptpubkey);
    if (pubkey !== undefined) return { pubkey, source: "output", txid: transaction.txid };
  }

  return undefined;
}

function countOf(
  stats: Readonly<EsploraAddressStats>,
  field: "spent_txo_count" | "tx_count",
): number {
  return stats.chain_stats[field] + (stats.mempool_stats?.[field] ?? 0);
}

/**
 * Find the key an address has shown, newest row first, within `ESPLORA_HISTORY_ROWS` rows.
 * Without a spend only a taproot output can show one, and every row pays it, so one page does.
 *
 * @param {string} address - The `address` value.
 * @param {() => Promise<EsploraAddressStats>} fetchStats - Read `/api/address/:address`.
 * @param {(path: string) => Promise<T[]>} fetchPage - Read one feed path.
 * @param {(encodedAddress: string, encodedCursor: string) => string} nextPagePath - Build the
 *   provider-specific confirmed-history cursor path.
 * @returns {Promise<Omit<PubkeyReveal, "chain">>} The key and where it showed.
 */
export async function getEsploraPubkey<T extends EsploraKeyTransaction>(
  address: string,
  fetchStats: () => Promise<EsploraAddressStats>,
  fetchPage: (path: string) => Promise<T[]>,
  nextPagePath: (encodedAddress: string, encodedCursor: string) => string = confirmedHistoryPath,
): Promise<Omit<PubkeyReveal, "chain">> {
  assertSafePathSegment(address, "address");
  const stats = await fetchStats();
  const spent = countOf(stats, "spent_txo_count") > 0;
  const none = { address, pubkey: null, source: null, txid: null, spent };
  if (countOf(stats, "tx_count") === 0) return none;

  const feedAddress = SEGWIT_ADDRESS.test(address) ? address.toLowerCase() : address;
  let rows = 0;
  for await (const page of esploraHistoryPages(address, fetchPage, nextPagePath)) {
    for (const transaction of page) {
      const found = sighting(transaction, feedAddress);
      if (found !== undefined) return { address, ...found, spent };
    }
    rows += page.length;
    if (!spent || rows >= ESPLORA_HISTORY_ROWS) break;
  }

  return none;
}
