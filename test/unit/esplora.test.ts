import { describe, expect, it, vi } from "vitest";
import { getEsploraAddressHistory, selectEsploraRecipientOutput } from "../../src/core/esplora.js";

const ADDRESS = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa";

function historyTransaction(index: number) {
  return {
    txid: index.toString(16).padStart(64, "0"),
    status: { confirmed: true },
  };
}

describe("Esplora recipient selection", () => {
  it("skips OP_RETURN and the excluded address", () => {
    const output = selectEsploraRecipientOutput(
      [
        { scriptpubkey_type: "op_return", value: 0 },
        { scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: ADDRESS, value: 29_000 },
        { scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "recipient", value: 70_000 },
      ],
      ADDRESS,
    );

    expect(output).toEqual({ address: "recipient", value: 70_000 });
  });

  it("falls back to the excluded address when it is the only transfer output", () => {
    const output = selectEsploraRecipientOutput(
      [
        { scriptpubkey_type: "op_return", value: 0 },
        { scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: ADDRESS, value: 29_000 },
      ],
      ADDRESS,
    );

    expect(output).toEqual({ address: ADDRESS, value: 29_000 });
  });

  it("falls back to the first raw output when every output is OP_RETURN", () => {
    const output = selectEsploraRecipientOutput([
      { scriptpubkey_type: "op_return", value: 1 },
      { scriptpubkey_type: "op_return", value: 2 },
    ]);

    expect(output).toEqual({ address: null, value: 1 });
  });
});

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
