import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { create } from "../../src/core/registry.ts";

const ADDRESS = "bc1qrkfl07kmrmqejhpj5cn7552jre86cf70wttmdk";
const CAPITALS = ADDRESS.toUpperCase();
const RECIPIENT = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh";
const STATUS = { confirmed: true, block_height: 900_000, block_time: 1_749_188_499 };

function output(address: string, value: number) {
  return { scriptpubkey_address: address, scriptpubkey_type: "v0_p2wpkh", value };
}

const SPEND = {
  txid: "a".repeat(64),
  vin: [{ prevout: output(ADDRESS, 100_000) }],
  vout: [output(ADDRESS, 29_000), output(RECIPIENT, 70_000)],
  fee: 1_000,
  status: STATUS,
};

const RECEIPT = {
  txid: "b".repeat(64),
  vin: [{ prevout: output(RECIPIENT, 50_000) }],
  vout: [output(ADDRESS, 49_000)],
  fee: 1_000,
  status: STATUS,
};

const SELF_SEND = {
  txid: "c".repeat(64),
  vin: [{ prevout: output(ADDRESS, 100_000) }],
  vout: [output(ADDRESS, 99_000)],
  fee: 1_000,
  status: STATUS,
};

afterEach(() => vi.unstubAllGlobals());

describe.each(["mempool", "blockstream"])("%s history of a segwit address in capitals", (key) => {
  async function history(address: string) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json([SPEND, RECEIPT, SELF_SEND])),
    );
    const provider = await create(key);
    return provider.getTxHistory(address, "bitcoin", { limit: 3 });
  }

  it("reads the spend as a send to the other party", async () => {
    const [spend] = await history(CAPITALS);

    expect(spend).toMatchObject({ from: CAPITALS, to: RECIPIENT, value: "70000" });
  });

  it("reads the receipt into the address as the caller wrote it", async () => {
    const [, receipt] = await history(CAPITALS);

    expect(receipt).toMatchObject({ from: RECIPIENT, to: CAPITALS, value: "49000" });
  });

  it("names the caller's spelling on both ends of a self-send", async () => {
    const [, , selfSend] = await history(CAPITALS);

    expect(selfSend).toMatchObject({ from: CAPITALS, to: CAPITALS, value: "0" });
  });

  it("gives the same amounts as the lowercase spelling", async () => {
    const lower = await history(ADDRESS);
    const upper = await history(CAPITALS);

    expect(upper.map(({ value }) => value)).toEqual(lower.map(({ value }) => value));
  });
});
