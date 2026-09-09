import { afterEach, describe, expect, it, vi } from "vitest";
import { create } from "../../src/core/registry.js";

const ADDRESS = "PqqJgKpAcMqoBaiy3aNHuR4SSLPdTz194q";
const RECIPIENT = "PftB3JYp6r3PPkiLPoPoT6vdS77NR4mhyb";
const HASH = "a".repeat(64);

function transactionJSON(
  inputs: readonly string[],
  outputs: readonly string[],
  fee = "1000",
  sender = ADDRESS,
): string {
  return `{
    "txid": "${HASH}",
    "vin": [${inputs.map((value) => `{"prevout":{"scriptpubkey_address":"${sender}","value":${value}}}`).join(",")}],
    "vout": [${outputs.join(",")}],
    "fee": ${fee},
    "status": {"confirmed": true, "block_height": 100}
  }`;
}

function outputJSON(address: string, value: string): string {
  return `{"scriptpubkey_address":"${address}","scriptpubkey_type":"p2pkh","value":${value}}`;
}

function stubResponse(body: string): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body, { headers: { "Content-Type": "application/json" } })),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("mempool Pepecoin amounts", () => {
  it.each([
    ["one unsafe output", ["9007199254740993"], "9007199254740993", "90071992.54740993"],
    [
      "two unsafe outputs",
      ["9007199254740993", "9007199254740993"],
      "18014398509481986",
      "180143985.09481986",
    ],
    [
      "safe outputs with an unsafe sum",
      ["9007199254740990", "3"],
      "9007199254740993",
      "90071992.54740993",
    ],
  ])("keeps received amounts exact for %s", async (_label, amounts, value, valueFormatted) => {
    stubResponse(
      `[${transactionJSON(
        [(BigInt(value) + 1000n).toString()],
        amounts.map((amount) => outputJSON(ADDRESS, amount)),
        "1000",
        RECIPIENT,
      )}]`,
    );
    const provider = await create("mempool");

    const transactions = await provider.getTxHistory(ADDRESS, "pepecoin", { limit: 1 });

    expect(transactions).toMatchObject([{ to: ADDRESS, value, valueFormatted, fee: "1000" }]);
  });

  it("subtracts change and the fee from multiple large inputs exactly", async () => {
    stubResponse(
      `[${transactionJSON(
        ["9007199254740993", "9007199254740993"],
        [outputJSON(ADDRESS, "2000"), outputJSON(RECIPIENT, "18014398509478986")],
      )}]`,
    );
    const provider = await create("mempool");

    const transactions = await provider.getTxHistory(ADDRESS, "pepecoin", { limit: 1 });

    expect(transactions).toMatchObject([
      {
        from: ADDRESS,
        to: RECIPIENT,
        value: "18014398509478986",
        valueFormatted: "180143985.09478986",
        fee: "1000",
      },
    ]);
  });

  it("keeps a large self-transfer at zero after subtracting the fee", async () => {
    stubResponse(
      `[${transactionJSON(["9007199254741993"], [outputJSON(ADDRESS, "9007199254740993")])}]`,
    );
    const provider = await create("mempool");

    const transactions = await provider.getTxHistory(ADDRESS, "pepecoin", { limit: 1 });

    expect(transactions).toMatchObject([{ value: "0", valueFormatted: "0" }]);
  });

  it("preserves the selected output in transaction details", async () => {
    stubResponse(
      transactionJSON(["9007199254741993"], [outputJSON(RECIPIENT, "9007199254740993")]),
    );
    const provider = await create("mempool");
    if (!provider.capabilities.txDetail || !provider.getTxDetail)
      throw new Error("Missing detail capability");

    const transaction = await provider.getTxDetail(HASH, "pepecoin");

    expect(transaction).toMatchObject({
      to: RECIPIENT,
      value: "9007199254740993",
      valueFormatted: "90071992.54740993",
    });
  });
});
