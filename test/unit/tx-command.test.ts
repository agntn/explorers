import consola from "consola";
import { afterEach, describe, expect, it, vi } from "vitest";
import txCommand from "../../src/commands/tx.js";

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
}

describe("tx command", () => {
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
      'Provider "blockberry" does not support transaction details',
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
