import { assertSafePathSegment } from "./path-safety.js";
import { clampMaxResults } from "./types.js";

const CHAIN_PAGE_SIZE = 25;

interface EsploraAddressTransaction {
  txid: string;
  status: { confirmed: boolean };
}

interface EsploraOutput {
  readonly scriptpubkey_address?: string;
  readonly scriptpubkey_type: string;
  readonly value: number;
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
 * @returns {Readonly<{ address: string | null; value: number }>} The selected output pair.
 */
export function selectEsploraRecipientOutput(
  outputs: readonly EsploraOutput[],
  excludedAddress?: string,
): Readonly<{ address: string | null; value: number }> {
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
