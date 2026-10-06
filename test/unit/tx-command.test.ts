import consola from "consola";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import txCommand from "../../src/commands/tx.ts";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function useOnlyBlockberryCredentials(): void {
  vi.stubEnv("ETHERSCAN_API_KEY", "");
  vi.stubEnv("BLOCKCHAIR_API_KEY", "");
  vi.stubEnv("SOLSCAN_API_KEY", "");
  vi.stubEnv("HELIUS_API_KEY", "");
  vi.stubEnv("TRONSCAN_API_KEY", "");
  vi.stubEnv("BLOCKBERRY_API_KEY", "configured");
  vi.stubEnv("WHATSONCHAIN_API_KEY", "");
}

function stubJSON(body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ),
  );
}

function spyOnOutput() {
  vi.spyOn(process, "exit").mockImplementation(() => {
    throw new Error("exit");
  });
  return vi.spyOn(consola, "log").mockImplementation(() => undefined);
}

describe("tx command", () => {
  it("prints the contract a deployment created instead of a recipient", async () => {
    const hash = `0x${"e".repeat(64)}`;
    const created = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
    stubJSON({
      hash,
      block_number: 6_082_465,
      timestamp: "2018-08-03T19:28:24.000000Z",
      from: { hash: "0x95Ba4cF87D6723ad9C0Db21737D862bE80e93911" },
      to: null,
      created_contract: { hash: created },
      value: "0",
      gas_used: "1500000",
      gas_price: "5000000000",
      status: "ok",
      transaction_types: ["contract_creation"],
    });
    const log = spyOnOutput();

    await txCommand.run?.({
      args: { _: [], target: hash, limit: "10", provider: "blockscout", chain: "eth" },
    });

    expect(log.mock.calls.map(([line]) => String(line))).toEqual([
      `[blockscout] Tx ${hash}`,
      "  Block: 6082465",
      "  From: 0x95Ba4cF87D6723ad9C0Db21737D862bE80e93911",
      `  Created contract: ${created}`,
      "  Value: 0",
      "  Status: success",
      "  Fee: 7500000000000000 base units",
    ]);
  });

  it("prints no recipient line for a transaction the explorer gives none", async () => {
    vi.stubEnv("HELIUS_API_KEY", "secret");
    const signature =
      "4WXrE8Fz4fz3B5ETYL3dC7f4NX6jTumoJ3eC3ELQCdMoaXuke6c9rADiZ6pcuzGjgKjfhNu3e8UKPQhDXk5h5qbo";
    stubJSON([
      {
        signature,
        slot: 448_446_378,
        timestamp: 1_789_837_200,
        fee: 167_689,
        feePayer: "Ew4YAextA2RJjPvJoZxmMZpZJdmcpTBJa2bN1U6Ptb2T",
        type: "SWAP",
        transactionError: null,
        instructions: [{ programId: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4" }],
      },
    ]);
    const log = spyOnOutput();

    await txCommand.run?.({
      args: { _: [], target: signature, limit: "10", provider: "helius", chain: "solana" },
    });

    expect(log.mock.calls.map(([line]) => String(line))).toEqual([
      `[helius] Tx ${signature}`,
      "  Block: 448446378",
      "  From: Ew4YAextA2RJjPvJoZxmMZpZJdmcpTBJa2bN1U6Ptb2T",
      "  Value: 0",
      "  Status: success",
      "  Fee: 167689 base units",
    ]);
  });

  it("prints no recipient line for an Arweave data upload either", async () => {
    const id = "2Bg8S0GcQmbC-FeT5dDKcj0WOK2YmH7Y4mlW-mO8_yE";
    const owner = "FPjbN_btYKzcf8QASjs30v5C0FPv7XpwKXENBW8dqVw";
    stubJSON({
      data: {
        transaction: {
          id,
          owner: { address: owner },
          recipient: "",
          quantity: { winston: "0" },
          fee: { winston: "3242223203" },
          block: { height: 1_994_692, timestamp: 1_788_612_434 },
          bundledIn: null,
          data: { size: "3044", type: null },
          tags: [],
        },
      },
    });
    const log = spyOnOutput();

    await txCommand.run?.({
      args: {
        _: [],
        target: id,
        limit: "10",
        provider: "arweave",
        chain: "arweave",
        mode: "detail",
      },
    });

    expect(log.mock.calls.map(([line]) => String(line))).toEqual([
      `[arweave] Tx ${id}`,
      "  Block: 1994692",
      `  From: ${owner}`,
      "  Value: 0",
      "  Status: success",
      "  Fee: 3242223203 base units",
    ]);
  });

  it("prints no sender line for a transaction the explorer names no sender for", async () => {
    vi.stubEnv("BLOCKCHAIR_API_KEY", "");
    const hash = "8a1b50c0ad19c68cbbf3ac2cdaeb0a1a3c4ba8e0b3226e27ec9d9d17fe3e9e9e";
    stubJSON({
      data: {
        [hash]: {
          transaction: {
            block_id: 3_183_898,
            hash,
            time: "2026-09-25 03:08:17",
            output_total: 19_765_422_928_880,
            fee: 2680,
          },
          inputs: [],
          outputs: [],
        },
      },
      context: { code: 200 },
    });
    const log = spyOnOutput();

    await txCommand.run?.({
      args: { _: [], target: hash, limit: "10", provider: "blockchair", chain: "litecoin" },
    });

    expect(log.mock.calls.map(([line]) => String(line))).toEqual([
      `[blockchair] Tx ${hash}`,
      "  Block: 3183898",
      "  Value: 197654.2292888",
      "  Status: success",
      "  Fee: 2680 base units",
    ]);
  });

  it("marks a missing sender in a history line with a placeholder", async () => {
    useOnlyBlockberryCredentials();
    const address = "0x61953ea72709eed72f4441dd944eec49a11b4acabfc8e04015e89c63be81b6ab";
    stubJSON({
      content: [
        {
          activityType: ["MOVE_CALL"],
          activityWith: [],
          timestamp: 1_700_000_000_000,
          digest: "7xVY1uEZnDcqD5tJ3mQj",
          txStatus: "SUCCESS",
          gasFee: "123",
        },
      ],
    });
    const log = spyOnOutput();

    await txCommand.run?.({
      args: {
        _: [],
        target: address,
        limit: "1",
        provider: "blockberry",
        chain: "sui",
        mode: "history",
      },
    });

    expect(log.mock.calls.map(([line]) => String(line)).at(-1)).toBe(
      "  7xVY1uEZnDcqD5tJ3m…  ?… → ?…  [success]",
    );
  });

  it("keeps the inferred provider chain while routing an implicit detail operation", async () => {
    useOnlyBlockberryCredentials();
    const error = vi.spyOn(consola, "error").mockImplementation(() => undefined);
    const exit = new Error("exit");
    vi.spyOn(process, "exit").mockImplementation(() => {
      throw exit;
    });
    const fetch = vi.fn(async () => {
      throw new Error("network should not be reached");
    });
    vi.stubGlobal("fetch", fetch);

    await expect(
      txCommand.run?.({
        args: {
          _: [],
          target: "1".repeat(44),
          limit: "10",
        },
      }),
    ).rejects.toBe(exit);

    expect(error).toHaveBeenCalledWith(
      'Error: Operation "getTxDetail" not supported by blockberry; no provider serves this read on sui',
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("prints an inscription with its body indented and a large one as a note", async () => {
    const hash = "a".repeat(64);
    const envelope = (body: string) => `0063036f726401010a746578742f706c61696e00${body}68`;
    const text = Buffer.from("one\ntwo", "utf8");
    const tapscript = `20${"22".repeat(32)}ac${envelope(`0${text.length}${text.toString("hex")}`)}${envelope(`4d0110${"61".repeat(4097)}`)}`;
    stubJSON({
      txid: hash,
      vin: [{ prevout: null, witness: ["aa".repeat(64), tapscript, `c0${"11".repeat(32)}`] }],
      vout: [{ scriptpubkey_address: "bc1qrecipient", value: 2_000 }],
      fee: 1_000,
      status: { confirmed: true, block_height: 1, block_time: 1 },
    });
    const log = spyOnOutput();

    await txCommand.run?.({
      args: { _: [], target: hash, limit: "10", provider: "mempool", chain: "bitcoin" },
    });

    expect(log.mock.calls.map(([line]) => String(line)).slice(-5)).toEqual([
      "  Inscription: text/plain, 7 bytes (input 0)",
      "    one",
      "    two",
      "  Inscription: text/plain, 4097 bytes (input 0)",
      "    body too big to print, read it from the witness",
    ]);
  });
});
