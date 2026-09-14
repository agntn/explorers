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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stubTokenBalances(symbol: string, name: string) {
  const body = [
    {
      token: { address_hash: USDC, symbol, name, decimals: "6", type: "ERC-20" },
      value: "1250000",
    },
  ];
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
  it("drops the terminal controls a token symbol smuggles into the listing", async () => {
    const log = vi.spyOn(consola, "log").mockImplementation(() => undefined);
    vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    stubTokenBalances(`USDC${ESC}]0;pwned${BEL}`, `${CSI}2JUSD Coin`);

    await tokensCommand.run?.({
      args: { _: [], address: HOLDER, chain: "eth", provider: "blockscout" },
    });

    const lines = log.mock.calls.map(([line]) => String(line));
    expect(lines).toContain(`  USDC]0;pwned: 1.25  [${USDC.slice(0, 10)}…]`);
    const printed = lines.join(" ");
    expect(printed).not.toContain(ESC);
    expect(printed).not.toContain(BEL);
    expect(printed).not.toContain(CSI);
  });
});
