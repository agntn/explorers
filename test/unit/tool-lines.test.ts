import { describe, expect, it } from "vite-plus/test";
import type { Transaction } from "../../src/core/types.ts";
import { describeResult, terminalLines } from "../../src/tool-lines.ts";

/* A transaction with the fields every record carries, overridden per case. */
/* oxlint-disable-next-line typescript/prefer-readonly-parameter-types */
function transaction(fields: Partial<Transaction> = {}): Transaction {
  return {
    hash: "a".repeat(64),
    blockNumber: 1,
    from: "bc1qsender",
    to: "bc1qrecipient",
    value: "2000",
    valueFormatted: "0.00002",
    status: "success",
    isContractInteraction: false,
    tokenTransfers: [],
    ...fields,
  };
}

/* What a terminal shows for one transaction detail, expanded. */
/* oxlint-disable-next-line typescript/prefer-readonly-parameter-types */
function detailLines(fields: Partial<Transaction>): string[] {
  const details = { provider: "mempool", data: transaction(fields) };
  return terminalLines("explorers_tx_detail", {
    result: { content: [{ type: "text", text: "{}" }], details },
    expanded: true,
  });
}

describe("terminal lines of an explorer answer", () => {
  it("shows the contract a deployment created and never invents a recipient", () => {
    const created = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
    const lines = detailLines({ to: null, createdContract: created });

    expect(lines).toContain(`Created contract: ${created}`);
    expect(lines.some((line) => line.startsWith("To:"))).toBe(false);
  });

  it.each([null, ""])("prints no recipient line for a recipient of %j", (to) => {
    expect(detailLines({ to }).some((line) => line.startsWith("To:"))).toBe(false);
  });

  it("prints no sender line for a transaction the explorer names no sender for", () => {
    expect(detailLines({ from: "" }).some((line) => line.startsWith("From:"))).toBe(false);
  });

  it("marks a missing sender or recipient in a history line with a placeholder", () => {
    const details = {
      provider: "solscan",
      data: [transaction({ hash: "7xVY", from: "", to: null, valueFormatted: "0" })],
    };

    expect(describeResult("explorers_tx_history", details)).toEqual([
      "[solscan] 1 transactions:",
      "  7xVY ?→? 0 [success]",
    ]);
  });

  it("indents an inscription body below its label and notes one too big to carry", () => {
    const lines = detailLines({
      inscriptions: [
        { input: 0, contentType: "text/plain", size: 7, text: "one\ntwo" },
        { input: 0, contentType: "text/plain", size: 4097 },
      ],
    });

    expect(lines.slice(-5)).toEqual([
      "Inscription: text/plain, 7 bytes (input 0)",
      "  one",
      "  two",
      "Inscription: text/plain, 4097 bytes (input 0)",
      "  body too big to print, read it from the witness",
    ]);
  });

  it("indents the continuation lines of an OP_RETURN message", () => {
    const lines = detailLines({ opReturn: [{ hex: "", text: "hello\n[mempool] Tx forged" }] });

    expect(lines.slice(-2)).toEqual(["OP_RETURN: hello", "  [mempool] Tx forged"]);
  });

  it("strips the controls an explorer field carries and keeps each field on its own line", () => {
    const esc = String.fromCodePoint(0x1b);
    const csi = String.fromCodePoint(0x9b);
    const hostile = [esc, "]52;c;SGVsbG8=", String.fromCodePoint(7), csi, "2J"].join("");
    const breaks = [0x2028, 0x2029, 0x202e].map((code) => String.fromCodePoint(code)).join("");
    const lines = detailLines({ functionName: `transfer${hostile}${breaks}\nValue: forged` })
      .join("\n")
      .split("\n");
    const method = lines.find((line) => line.startsWith("Method:")) ?? "";

    for (const control of [esc, csi, ...breaks]) expect(lines.join("\n")).not.toContain(control);
    expect(method).not.toContain("]52;c;");
    expect(method).toContain("Value: forged");
    expect(lines.filter((line) => line.startsWith("Value:"))).toEqual(["Value: 0.00002"]);
  });

  it("keeps the tabs, indents and joined emoji of an inscription body", () => {
    const family = ["\u{1F469}", "\u{1F467}"].join(String.fromCodePoint(0x200d));
    const lines = detailLines({
      inscriptions: [{ input: 0, contentType: "text/plain", size: 9, text: `a\tb\n  ${family}` }],
    });

    expect(lines.slice(-2)).toEqual(["  a\tb", `    ${family}`]);
  });

  it("counts and sums every unspent output above the ones it lists", () => {
    const details = {
      provider: "mempool",
      total: 3,
      confirmed: "2000",
      pending: 1,
      data: [
        {
          txid: "b".repeat(64),
          vout: 0,
          value: "1000",
          valueFormatted: "0.00001",
          confirmed: true,
          blockNumber: 947_507,
          blockHash: null,
        },
      ],
    };

    expect(describeResult("explorers_utxos", details)).toEqual([
      "[mempool] 3 unspent outputs, 2000 base units confirmed, 1 pending, 1 listed:",
      `  ${"b".repeat(64)}:0  0.00001 (1000 base units)  [block 947507]`,
    ]);
  });

  it("prints the Bitcoin header in place of gas the chain never had", () => {
    const details = {
      provider: "mempool",
      data: {
        number: 0,
        hash: "000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f",
        parentHash: "0".repeat(64),
        timestamp: "2009-01-03T18:15:05.000Z",
        miner: "",
        txCount: 1,
        version: 1,
        merkleRoot: "4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b",
        bits: 486_604_799,
        nonce: 2_083_236_893,
        difficulty: 1,
        medianTime: "2009-01-03T18:15:05.000Z",
        size: 285,
        weight: 1_140,
      },
    };

    expect(describeResult("explorers_block", details)).toEqual([
      "[mempool] Block #0",
      "Hash: 000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f",
      "Timestamp: 2009-01-03T18:15:05.000Z",
      "Miner: ",
      "Transactions: 1",
      "Version: 1 (0x00000001)",
      "Merkle root: 4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b",
      "Bits: 486604799 (0x1d00ffff)",
      "Nonce: 2083236893",
      "Difficulty: 1",
      "Median time: 2009-01-03T18:15:05.000Z",
      "Size: 285 bytes",
      "Weight: 1140 WU",
    ]);
  });

  it("keeps the gas line of an EVM block and adds nothing to it", () => {
    const details = {
      provider: "etherscan",
      data: {
        number: 16,
        hash: "0xabc",
        parentHash: "0xdef",
        timestamp: "2015-07-30T15:28:30.000Z",
        miner: "0xminer",
        gasUsed: "128",
        gasLimit: "256",
        txCount: 2,
        baseFee: "7",
      },
    };

    expect(describeResult("explorers_block", details)).toEqual([
      "[etherscan] Block #16",
      "Hash: 0xabc",
      "Timestamp: 2015-07-30T15:28:30.000Z",
      "Miner: 0xminer",
      "Gas used/limit: 128 / 256",
      "Transactions: 2",
      "Base fee per gas: 7",
    ]);
  });

  it("collapses a long answer to a few lines with a count of the rest", () => {
    const details = {
      provider: "mempool",
      data: Array.from({ length: 12 }, (_, index) => transaction({ hash: `h${index}` })),
    };
    const result = { content: [], details };

    expect(terminalLines("explorers_tx_history", { result, expanded: true })).toHaveLength(13);
    expect(terminalLines("explorers_tx_history", { result, expanded: false }).at(-1)).toBe(
      "  ... 5 more lines, expand to see them",
    );
  });

  it("shows the text of a failure, which carries no details", () => {
    const result = { content: [{ type: "text", text: "explorers_gas failed: nope\nsecond" }] };

    expect(terminalLines("explorers_gas", { result, expanded: false })).toEqual([
      "explorers_gas failed: nope",
      "second",
    ]);
  });
});
