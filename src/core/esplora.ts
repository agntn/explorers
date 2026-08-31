import { assertSafePathSegment } from "./path-safety.js";
import { clampMaxResults } from "./types.js";

const CHAIN_PAGE_SIZE = 25;

interface EsploraAddressTransaction {
  txid: string;
  status: { confirmed: boolean };
}

interface EsploraOutput {
  readonly scriptpubkey_address?: string;
  readonly value: number;
}

/**
 * Keep the singular normalized recipient and value on one Esplora output.
 *
 * @param {readonly EsploraOutput[]} outputs - Transaction outputs in provider order.
 * @returns {Readonly<{ address: string | null; value: number }>} The first output pair.
 */
export function getFirstEsploraOutput(
  outputs: readonly EsploraOutput[],
): Readonly<{ address: string | null; value: number }> {
  const output = outputs[0];
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
 * @returns {Promise<T[]>} The resulting value.
 */
export async function getEsploraAddressHistory<T extends EsploraAddressTransaction>(
  address: string,
  requestedLimit: number | undefined,
  fetchPage: (path: string) => Promise<T[]>,
): Promise<T[]> {
  const limit = clampMaxResults(requestedLimit);
  assertSafePathSegment(address, "address");
  const encodedAddress = encodeURIComponent(address);
  const firstPage = await fetchPage(`/api/address/${encodedAddress}/txs`);
  const transactions = firstPage.slice(0, limit);
  let cursor = firstPage.findLast((transaction) => transaction.status.confirmed)?.txid;

  while (transactions.length < limit && cursor !== undefined) {
    const page = await fetchPage(
      `/api/address/${encodedAddress}/txs/chain/${encodeURIComponent(cursor)}`,
    );
    const nextCursor = page.at(-1)?.txid;
    if (nextCursor === undefined || nextCursor === cursor) break;

    transactions.push(...page.slice(0, limit - transactions.length));
    if (page.length < CHAIN_PAGE_SIZE) break;
    cursor = nextCursor;
  }

  return transactions;
}
