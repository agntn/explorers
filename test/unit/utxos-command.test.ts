import consola from "consola";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import utxosCommand from "../../src/commands/utxos.ts";

const ADDRESS = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("utxos command", () => {
  it("lists fifty outputs unless --limit says otherwise and counts every one", async () => {
    const log = vi.spyOn(consola, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(consola, "error").mockImplementation(() => undefined);
    vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
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
    const run = async (limit?: string) => {
      log.mockClear();
      await utxosCommand.run?.({
        args: { _: [], address: ADDRESS, chain: "btc", provider: "mempool", limit: limit ?? "50" },
      });
      return log.mock.calls.map(([line]) => String(line));
    };
    const summary = ["  Confirmed total: 119000 base units", "  Pending: 1", ""];

    const listed = await run();
    expect(listed).toHaveLength(54);
    expect(listed.slice(0, 4)).toEqual([
      `[mempool] 120 unspent outputs for ${ADDRESS} on bitcoin, 50 listed`,
      ...summary,
    ]);
    expect(listed[53]).toBe(`  ${txidOf(49)}:0  0.00001  [block 947507]`);
    expect(await run("2")).toEqual([
      `[mempool] 120 unspent outputs for ${ADDRESS} on bitcoin, 2 listed`,
      ...summary,
      `  ${txidOf(0)}:0  0.00001  [block 947507]`,
      `  ${txidOf(1)}:0  0.00001  [block 947507]`,
    ]);
    for (const limit of ["100", "1000"]) {
      const hundred = await run(limit);
      expect(hundred).toHaveLength(104);
      expect(hundred[0]).toBe(
        `[mempool] 120 unspent outputs for ${ADDRESS} on bitcoin, 100 listed`,
      );
    }
    await expect(run("0")).rejects.toThrow("exit");
    expect(error).toHaveBeenCalledWith("Invalid --limit value");
  });
});
