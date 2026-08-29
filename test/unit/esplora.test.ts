import { describe, expect, it, vi } from "vitest";
import { getEsploraAddressHistory } from "../../src/core/esplora.js";

const ADDRESS = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa";

function historyTransaction(index: number) {
  return {
    txid: index.toString(16).padStart(64, "0"),
    status: { confirmed: true },
  };
}

describe("Esplora address history", () => {
  it("rejects an unsafe address before requesting a page", async () => {
    const fetchPage = vi.fn(async () => [historyTransaction(0)]);

    await expect(getEsploraAddressHistory("../admin", 30, fetchPage)).rejects.toThrow(
      /separator|traversal/,
    );
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("stops before appending a page that repeats its cursor", async () => {
    const page = Array.from({ length: 25 }, (_, index) => historyTransaction(index));
    const cursor = page.at(-1)!.txid;
    const fetchPage = vi.fn(async () => page);

    const transactions = await getEsploraAddressHistory(ADDRESS, 30, fetchPage);

    expect(transactions).toEqual(page);
    expect(fetchPage.mock.calls.map(([path]) => path)).toEqual([
      `/api/address/${ADDRESS}/txs`,
      `/api/address/${ADDRESS}/txs/chain/${cursor}`,
    ]);
  });
});
