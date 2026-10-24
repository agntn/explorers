/// <reference types="node" />
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { runExplorersCli } from "../../src/cli-run.ts";
import "../../src/providers/index.ts";

const ADDRESS = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh";
const HOLDER = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  process.exitCode = undefined;
});

/* Runs one command line in this process and collects what it printed and the exit code. */
async function run(argv: readonly string[]) {
  let stdout = "";
  let stderr = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
  process.exitCode = undefined;
  await runExplorersCli(argv);
  const exitCode = process.exitCode;
  process.exitCode = undefined;
  vi.mocked(process.stdout.write).mockRestore();
  vi.mocked(process.stderr.write).mockRestore();
  return { stdout, stderr, exitCode };
}

/* A fetch that fails the test the moment a command reaches the network. */
function offline() {
  const fetch = vi.fn(async () => {
    throw new Error("network should not be reached");
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("explorers commands", () => {
  it("lists fifty outputs unless --limit says otherwise and counts and sums every one", async () => {
    const txidOf = (index: number) => index.toString(16).padStart(64, "0");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          Array.from({ length: 120 }, (_, index) => ({
            txid: txidOf(index),
            vout: 0,
            value: 1000,
            status:
              index === 119 ? { confirmed: false } : { confirmed: true, block_height: 947_507 },
          })),
        ),
      ),
    );
    const read = async (...flags: readonly string[]) => {
      const { stdout } = await run(["utxos", ADDRESS, "-c", "btc", "-p", "mempool", ...flags]);
      return JSON.parse(stdout) as { total: number; confirmed: string; data: unknown[] };
    };

    expect(await read()).toMatchObject({
      provider: "mempool",
      total: 120,
      confirmed: "119000",
      pending: 1,
    });
    expect((await read()).data).toHaveLength(50);
    expect((await read("-n", "2")).data).toEqual([
      expect.objectContaining({ txid: txidOf(0), blockNumber: 947_507 }),
      expect.objectContaining({ txid: txidOf(1) }),
    ]);
    expect((await read("--limit", "100")).data).toHaveLength(100);

    const refused = await run(["utxos", ADDRESS, "-p", "mempool", "-n", "1000"]);
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain("--limit");
  });

  it("lists fifty holdings unless --limit says otherwise and counts every one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          Array.from({ length: 60 }, (_, index) => ({
            token: {
              address_hash: `0x${(index + 16).toString(16).padStart(40, "0")}`,
              symbol: `T${index}`,
              decimals: "0",
              type: "ERC-20",
            },
            value: "1",
          })),
        ),
      ),
    );
    const read = async (...flags: readonly string[]) => {
      const { stdout } = await run(["tokens", HOLDER, "-c", "eth", "-p", "blockscout", ...flags]);
      return JSON.parse(stdout) as { total: number; data: unknown[] };
    };

    expect(await read()).toMatchObject({ provider: "blockscout", total: 60 });
    expect((await read()).data).toHaveLength(50);
    expect((await read("-n", "2")).data).toHaveLength(2);
  });

  it("escapes the terminal controls a token symbol smuggles into the JSON it prints", async () => {
    const esc = String.fromCodePoint(0x1b);
    const csi = String.fromCodePoint(0x9b);
    const lineSeparator = String.fromCodePoint(0x2028);
    const symbol = `USDC${esc}]0;pwned${String.fromCodePoint(7)}\n${csi}2J${lineSeparator}forged`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json([
          {
            token: { address_hash: `0x${"1".repeat(40)}`, symbol, decimals: "6", type: "ERC-20" },
            value: "1250000",
          },
        ]),
      ),
    );

    const { stdout } = await run(["tokens", HOLDER, "-c", "eth", "-p", "blockscout"]);

    expect(stdout.trimEnd().split("\n")).toHaveLength(1);
    for (const control of [esc, csi, lineSeparator]) expect(stdout).not.toContain(control);
    expect(JSON.parse(stdout)).toMatchObject({ data: [{ symbol, balanceFormatted: "1.25" }] });
  });

  it.each([
    {
      argv: ["gas", "-c", "solana"],
      env: { SOLSCAN_API_KEY: "", HELIUS_API_KEY: "configured" },
      message:
        'Operation "getGasData" not supported by helius; no provider serves this read on solana',
    },
    {
      argv: ["tokens", "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", "-c", "bitcoin"],
      env: { BLOCKCHAIR_API_KEY: "" },
      message:
        'Operation "getTokenBalances" not supported by mempool; no provider serves this read on bitcoin',
    },
    {
      argv: [
        "utxos",
        "qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a",
        "-c",
        "bch",
        "-p",
        "blockchair",
      ],
      env: {},
      message: 'Operation "getUtxos" not supported by blockchair; try haskoin',
    },
    {
      argv: ["tx", "1".repeat(44)],
      env: {
        ETHERSCAN_API_KEY: "",
        BLOCKCHAIR_API_KEY: "",
        SOLSCAN_API_KEY: "",
        HELIUS_API_KEY: "",
        TRONSCAN_API_KEY: "",
        BLOCKBERRY_API_KEY: "configured",
        WHATSONCHAIN_API_KEY: "",
      },
      message:
        'Operation "getTxDetail" not supported by blockberry; no provider serves this read on sui',
    },
  ])("names who serves the read when $argv.0 is refused", async ({ argv, env, message }) => {
    for (const [name, value] of Object.entries<string>(env)) vi.stubEnv(name, value);
    const fetch = offline();

    const { stderr, exitCode } = await run(argv);

    expect(exitCode).toBe(1);
    expect(stderr).toContain(message);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reads a word no command takes as an address to balance, several as a batch", async () => {
    const fetch = vi.fn(async () =>
      Response.json({
        chain_stats: { funded_txo_sum: 1000, spent_txo_sum: 0 },
        mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
      }),
    );
    vi.stubGlobal("fetch", fetch);

    const one = JSON.parse((await run([ADDRESS])).stdout) as { data: { balance: string } };
    const two = JSON.parse((await run(["balance", ADDRESS, ADDRESS])).stdout) as {
      data: unknown[];
    };

    expect(one).toMatchObject({ provider: "mempool", data: { balance: "1000" } });
    expect(two.data).toHaveLength(2);
  });
});
