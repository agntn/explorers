import { fileURLToPath } from "node:url";
import { validateInput } from "@agntn/tools";
import type {
  ExtensionAPI,
  ExtensionToolContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import explorersExtension, { resolveExplorersModuleUrl } from "../../extensions/pi/explorers.ts";
import type { Transaction } from "../../src/core/types.ts";
import "../../src/providers/index.ts";
import { explorersTools } from "../../src/tools.ts";

/* Registers the extension against a host that only keeps the tools it is handed. */
async function registerExtensionTools(): Promise<Map<string, ToolDefinition>> {
  const tools = new Map<string, ToolDefinition>();
  const api = {
    registerTool(tool: ToolDefinition) {
      tools.set(tool.name, tool);
    },
  };

  // SAFETY: the extension only calls registerTool during registration; the fake implements that exact seam.
  await explorersExtension(api as unknown as ExtensionAPI);
  return tools;
}

/* The one method of a tool map a lookup reads. */
interface ToolLookup {
  readonly get: (name: string) => ToolDefinition | undefined;
}

/* One registered tool, or a failed test naming the one that's missing. */
function requireTool(tools: ToolLookup, name: string): ToolDefinition {
  const tool = tools.get(name);
  if (!tool) throw new Error(`Tool not registered: ${name}`);
  return tool;
}

/* The shared definition behind a registered tool, for checks of its schema. */
function definition(name: string) {
  const tool = explorersTools().find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`No definition: ${name}`);
  return tool;
}

/* The text and details a tool call returned. */
function textOf(result: unknown): string {
  const content = (result as { content: Array<{ text?: string }> }).content;
  return content[0]?.text ?? "";
}

// SAFETY: the tested execute functions do not read ExtensionContext.
const unusedContext = {} as ExtensionToolContext;

type RenderTheme = Parameters<NonNullable<ToolDefinition["renderCall"]>>[1];

/* A theme that draws text as it is, so a test reads exactly what the renderer composed. */
const plainTheme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as RenderTheme;

const TOOL_NAMES = [
  "explorers_providers",
  "explorers_balance",
  "explorers_tx_history",
  "explorers_tx_detail",
  "explorers_utxos",
  "explorers_pubkey",
  "explorers_contract",
  "explorers_tokens",
  "explorers_token_transfers",
  "explorers_gas",
  "explorers_block",
];

describe("explorers Pi extension", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("loads live source instead of a missing or stale build in a checkout", () => {
    expect(fileURLToPath(resolveExplorersModuleUrl())).toBe(
      fileURLToPath(new URL("../../src/tools.ts", import.meta.url)),
    );
  });

  it("registers the shared definitions, each under its title and schema", async () => {
    const tools = await registerExtensionTools();

    expect([...tools.keys()]).toEqual(TOOL_NAMES);
    for (const tool of tools.values()) {
      expect(tool.label).toBe(definition(tool.name).title);
      expect(tool.parameters).toBe(definition(tool.name).input);
    }
  });

  it("names each tool in every prompt guideline", async () => {
    for (const tool of (await registerExtensionTools()).values()) {
      expect(tool.promptGuidelines).not.toHaveLength(0);
      for (const guideline of tool.promptGuidelines ?? []) expect(guideline).toContain(tool.name);
    }
  });

  it("declares an integer history limit up to 100, with 0 as the default OMP fills in", () => {
    const tool = definition("explorers_tx_history");
    const takes = (limit: unknown) => validateInput(tool, { address: "address", limit }).ok;

    expect([0, 1, 100].map(takes)).toEqual([true, true, true]);
    expect([101, 1.5, -1].map(takes)).toEqual([false, false, false]);
  });

  it("declares a non-negative integer block number", () => {
    const tool = definition("explorers_block");
    const takes = (blockNumber: unknown) => validateInput(tool, { blockNumber }).ok;

    expect([0, 21_000_000].map(takes)).toEqual([true, true]);
    expect([-1, 1.5, "1"].map(takes)).toEqual([false, false, false]);
  });

  it("takes no blank address, chain or provider", () => {
    const tool = definition("explorers_balance");
    const takes = (args: Readonly<Record<string, unknown>>) => validateInput(tool, args).ok;

    expect(takes({ address: ["a1", "a2"] })).toBe(true);
    expect(takes({ address: "  0xabc  " })).toBe(true);
    for (const address of ["", "   ", [], [""], ["   "]]) expect(takes({ address })).toBe(false);
    expect(takes({ address: "a", chain: "" })).toBe(false);
    expect(takes({ address: "a", provider: " " })).toBe(false);
  });

  it("draws the call under its title with the controls stripped from the arguments", async () => {
    const tool = requireTool(await registerExtensionTools(), "explorers_balance");
    const attack = "safe\u001B]52;c;SGVsbG8=\u0007address";

    const rendered = tool
      .renderCall?.({ address: attack, chain: "btc" }, plainTheme, {} as never)
      .render(200)
      .join("\n");

    expect(rendered).toContain("Get Balance safe");
    expect(rendered).toContain("address chain=btc");
    /* oxlint-disable-next-line no-control-regex */
    expect(rendered).not.toMatch(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/u);
  });

  it("hands the model compact JSON and the terminal one line per balance", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          chain_stats: { funded_txo_sum: 10_000, spent_txo_sum: 2000 },
          mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 6000 },
        }),
      ),
    );
    const tool = requireTool(await registerExtensionTools(), "explorers_balance");

    const result = await tool.execute(
      "test",
      { address: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh", provider: "mempool" },
      undefined,
      undefined,
      unusedContext,
    );
    const rendered = tool
      .renderResult?.(result, { expanded: false, isPartial: false }, plainTheme, {} as never)
      .render(400)
      .join("\n");

    expect(JSON.parse(textOf(result))).toMatchObject({
      provider: "mempool",
      data: { balance: "8000", unconfirmed: "-6000" },
    });
    expect(rendered).toContain("0.00008 BTC (8000 base units");
    expect(rendered).toContain("unconfirmed delta -6000 base units");
  });

  it("aborts the explorer request when the host cancels the tool", async () => {
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            if (init?.signal) signals.push(init.signal);
            init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
              once: true,
            });
          }),
      ),
    );
    const tool = requireTool(await registerExtensionTools(), "explorers_balance");
    const controller = new AbortController();

    const call = tool
      .execute(
        "test",
        { address: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh", chain: "bitcoin" },
        controller.signal,
        undefined,
        unusedContext,
      )
      .catch((error: unknown) => error);
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    controller.abort();

    await call;
    expect(signals[0]?.aborted).toBe(true);
  });

  it("fails with the providers that serve the read when the chosen one can't", async () => {
    vi.stubEnv("SOLSCAN_API_KEY", "");
    vi.stubEnv("HELIUS_API_KEY", "configured");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const tool = requireTool(await registerExtensionTools(), "explorers_gas");

    await expect(
      tool.execute("test", { chain: "solana" }, undefined, undefined, unusedContext),
    ).rejects.toThrow(
      'Operation "getGasData" not supported by helius; no provider serves this read on solana',
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("lists fifty unspent outputs unless limit says otherwise and counts every one", async () => {
    const txidOf = (index: number) => index.toString(16).padStart(64, "0");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          Array.from({ length: 60 }, (_, index) => ({
            txid: txidOf(index),
            vout: 0,
            value: 1000,
            status: { confirmed: true, block_height: 947_507 },
          })),
        ),
      ),
    );
    const tool = requireTool(await registerExtensionTools(), "explorers_utxos");
    const read = async (limit?: number) =>
      JSON.parse(
        textOf(
          await tool.execute(
            "test",
            { address: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh", provider: "mempool", limit },
            undefined,
            undefined,
            unusedContext,
          ),
        ),
      ) as { total: number; data: unknown[] };

    expect(await read()).toMatchObject({ total: 60, confirmed: "60000", pending: 0 });
    expect((await read()).data).toHaveLength(50);
    expect((await read(0)).data).toHaveLength(50);
    expect((await read(2)).data).toHaveLength(2);
  });

  it("draws transaction detail from details, every explorer field on its own clean line", async () => {
    const tool = requireTool(await registerExtensionTools(), "explorers_tx_detail");
    // SAFETY: simulates an untrusted explorer violating the declared numeric response type.
    const transaction = {
      hash: "0xabc",
      blockNumber: "123\u001B]52;c;SGVsbG8=\u0007",
      from: "0xfrom",
      to: null,
      createdContract: "0xnew",
      value: "1000000000000000000",
      valueFormatted: "1 ETH",
      fee: "21000000000000",
      status: "success",
      functionName: "transfer\nTo: 0xforged",
      isContractInteraction: true,
      tokenTransfers: [],
      opReturn: [{ hex: "6f6e650a74776f", text: "one\nStatus: forged" }],
    } as unknown as Transaction;

    const rendered = tool
      .renderResult?.(
        {
          content: [{ type: "text", text: "{}" }],
          details: { provider: "mempool", data: transaction },
        },
        { expanded: true, isPartial: false },
        plainTheme,
        {} as never,
      )
      .render(200)
      .map((line) => line.trimEnd());

    expect(rendered).toEqual([
      "[mempool] Tx 0xabc",
      "Block: 123 | Status: success",
      "Fee: 21000000000000 base units",
      "From: 0xfrom",
      "Created contract: 0xnew",
      "Value: 1 ETH",
      "Method: transfer To: 0xforged",
      "OP_RETURN: one",
      "  Status: forged",
    ]);
  });

  it("says the explorer is still answering while the call runs", async () => {
    const tool = requireTool(await registerExtensionTools(), "explorers_block");

    const rendered = tool
      .renderResult?.(
        { content: [], details: undefined },
        { expanded: false, isPartial: true },
        plainTheme,
        {} as never,
      )
      .render(80)
      .join("\n");

    expect(rendered).toContain("Asking the explorer");
  });
});
