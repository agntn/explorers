import consola from "consola";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import gasCommand from "../../src/commands/gas.ts";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("gas command", () => {
  it("says nobody serves gas on a chain whose provider lacks it", async () => {
    vi.stubEnv("SOLSCAN_API_KEY", "");
    vi.stubEnv("HELIUS_API_KEY", "configured");
    const error = vi.spyOn(consola, "error").mockImplementation(() => undefined);
    const exit = new Error("exit");
    vi.spyOn(process, "exit").mockImplementation(() => {
      throw exit;
    });
    const fetch = vi.fn(async () => {
      throw new Error("network should not be reached");
    });
    vi.stubGlobal("fetch", fetch);

    await expect(gasCommand.run?.({ args: { _: [], chain: "solana" } })).rejects.toBe(exit);

    expect(error).toHaveBeenCalledWith(
      'Error: Operation "getGasData" not supported by helius; no provider serves this read on solana',
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
