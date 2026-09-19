import consola from "consola";
import { afterEach, describe, expect, it, vi } from "vitest";
import tokensCommand from "../../src/commands/tokens.js";

const HOLDER = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
/** ESC opens every ANSI and OSC sequence; BEL closes an OSC one. */
const ESC = String.fromCodePoint(0x1b);
const BEL = String.fromCodePoint(0x07);
/** A C1 control: the single-byte form of CSI, which most terminals obey like ESC [. */
const CSI = String.fromCodePoint(0x9b);
/** LINE SEPARATOR, a break the renderers never split on. */
const LINE_SEPARATOR = String.fromCodePoint(0x2028);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stubTokenBalances(symbol: string, name: string) {
  stubHoldings([
    {
      token: { address_hash: USDC, symbol, name, decimals: "6", type: "ERC-20" },
      value: "1250000",
    },
  ]);
}

function stubHoldings(body: readonly Readonly<Record<string, unknown>>[]) {
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

describe("tokens command", () => {
  it("lists fifty holdings unless --limit says otherwise and counts every one", async () => {
    const log = vi.spyOn(consola, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(consola, "error").mockImplementation(() => undefined);
    vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    const contractOf = (index: number) => `0x${(index + 16).toString(16).padStart(40, "0")}`;
    stubHoldings(
      Array.from({ length: 120 }, (_, index) => ({
        token: {
          address_hash: contractOf(index),
          symbol: `T${index}`,
          decimals: "0",
          type: "ERC-20",
        },
        value: "1",
      })),
    );
    const run = async (limit?: string) => {
      log.mockClear();
      await tokensCommand.run?.({
        args: {
          _: [],
          address: HOLDER,
          chain: "eth",
          provider: "blockscout",
          limit: limit ?? "50",
        },
      });
      return log.mock.calls.map(([line]) => String(line));
    };

    const listed = await run();
    expect(listed).toHaveLength(52);
    expect(listed[0]).toBe(`[blockscout] 120 tokens for ${HOLDER} on ethereum, 50 listed`);
    expect(listed[2]).toBe(`  T0: 1  [${contractOf(0).slice(0, 10)}…]`);
    expect(listed[51]).toBe(`  T49: 1  [${contractOf(49).slice(0, 10)}…]`);
    expect(await run("2")).toEqual([
      `[blockscout] 120 tokens for ${HOLDER} on ethereum, 2 listed`,
      "",
      `  T0: 1  [${contractOf(0).slice(0, 10)}…]`,
      `  T1: 1  [${contractOf(1).slice(0, 10)}…]`,
    ]);
    for (const limit of ["100", "1000"]) {
      const hundred = await run(limit);
      expect(hundred).toHaveLength(102);
      expect(hundred[0]).toBe(`[blockscout] 120 tokens for ${HOLDER} on ethereum, 100 listed`);
      expect(hundred[101]).toBe(`  T99: 1  [${contractOf(99).slice(0, 10)}…]`);
    }
    await expect(run("0")).rejects.toThrow("exit");
    expect(error).toHaveBeenCalledWith("Invalid --limit value");
  });

  it("drops the terminal controls a token symbol smuggles into the listing", async () => {
    const log = vi.spyOn(consola, "log").mockImplementation(() => undefined);
    vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    stubTokenBalances(`USDC${ESC}]0;pwned${BEL}`, `${CSI}2JUSD Coin`);

    await tokensCommand.run?.({
      args: { _: [], address: HOLDER, chain: "eth", provider: "blockscout", limit: "50" },
    });

    const lines = log.mock.calls.map(([line]) => String(line));
    expect(lines).toContain(`  USDC]0;pwned: 1.25  [${USDC.slice(0, 10)}…]`);
    const printed = lines.join(" ");
    expect(printed).not.toContain(ESC);
    expect(printed).not.toContain(BEL);
    expect(printed).not.toContain(CSI);
  });

  it("keeps a token symbol that breaks the line inside its own listing line", async () => {
    const log = vi.spyOn(consola, "log").mockImplementation(() => undefined);
    vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    stubTokenBalances(
      `USDC\n[blockscout] 1 tokens for ${HOLDER}${LINE_SEPARATOR}Value: forged`,
      "",
    );

    await tokensCommand.run?.({
      args: { _: [], address: HOLDER, chain: "eth", provider: "blockscout", limit: "50" },
    });

    const lines = log.mock.calls.map(([line]) => String(line));
    expect(lines).toEqual([
      `[blockscout] 1 tokens for ${HOLDER} on ethereum`,
      "",
      `  USDC[blockscout] 1 tokens for ${HOLDER}Value: forged: 1.25  [${USDC.slice(0, 10)}…]`,
    ]);
  });
});
