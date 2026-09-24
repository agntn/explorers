import { assertSafePathSegment } from "./path-safety.ts";
import { clampMaxResults, formatWei, toTimestamp } from "./types.ts";
import type { Utxo } from "./types.ts";

const CHAIN_PAGE_SIZE = 25;

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

/**
 * Fetch an Esplora address feed across its initial page and confirmed-chain cursor pages.
 *
 * @param {string} address - The `address` value.
 * @param {number | undefined} requestedLimit - The `requestedLimit` value.
 * @param {(path: string) => Promise<T[]>} fetchPage - The `fetchPage` value.
 * @param {(encodedAddress: string, encodedCursor: string) => string} nextPagePath - Build the
 *   provider-specific confirmed-history cursor path.
 * @returns {Promise<T[]>} The resulting value.
 */
export async function getEsploraAddressHistory<T extends EsploraAddressTransaction>(
  address: string,
  requestedLimit: number | undefined,
  fetchPage: (path: string) => Promise<T[]>,
  nextPagePath: (encodedAddress: string, encodedCursor: string) => string = confirmedHistoryPath,
): Promise<T[]> {
  const limit = clampMaxResults(requestedLimit);
  assertSafePathSegment(address, "address");
  const encodedAddress = encodeURIComponent(address);
  const firstPage = await fetchPage(`/api/address/${encodedAddress}/txs`);
  const transactions = firstPage.slice(0, limit);
  let cursor = firstPage.findLast((transaction) => transaction.status.confirmed)?.txid;

  while (transactions.length < limit && cursor !== undefined) {
    const page = await fetchPage(nextPagePath(encodedAddress, encodeURIComponent(cursor)));
    const nextCursor = page.at(-1)?.txid;
    if (nextCursor === undefined || nextCursor === cursor) break;

    transactions.push(...page.slice(0, limit - transactions.length));
    if (page.length < CHAIN_PAGE_SIZE) break;
    cursor = nextCursor;
  }

  return transactions;
}
