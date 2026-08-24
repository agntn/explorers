import type {
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { Value } from "typebox/value";
import explorersExtension from "../../packages/pi/extensions/explorers.js";
import type { Transaction } from "../../src/core/types.js";

function registerExtensionTools(): Map<string, ToolDefinition> {
  const tools = new Map<string, ToolDefinition>();
  const api = {
    registerTool(tool: ToolDefinition) {
      tools.set(tool.name, tool);
    },
  };

  // SAFETY: the extension only calls registerTool during registration; the fake implements that exact seam.
  explorersExtension(api as unknown as ExtensionAPI);
  return tools;
}

function requireTool(tools: Map<string, ToolDefinition>, name: string): ToolDefinition {
  const tool = tools.get(name);
  if (!tool) throw new Error(`Tool not registered: ${name}`);
  return tool;
}

// SAFETY: the tested execute functions do not read ExtensionContext.
const unusedContext = {} as ExtensionContext;

describe("explorers Pi extension", () => {
  it("registers the complete tool set", () => {
    const tools = registerExtensionTools();

    expect([...tools.keys()]).toEqual([
      "explorers_balance",
      "explorers_tx_history",
      "explorers_tx_detail",
      "explorers_contract",
      "explorers_tokens",
      "explorers_token_transfers",
      "explorers_gas",
      "explorers_block",
      "explorers_providers",
    ]);
  });

  it("names each tool in every prompt guideline", () => {
    const tools = registerExtensionTools();

    for (const tool of tools.values()) {
      expect(tool.promptGuidelines).not.toHaveLength(0);
      for (const guideline of tool.promptGuidelines ?? []) {
        expect(guideline).toContain(tool.name);
      }
    }
  });

  it("declares an integer transaction-history limit from 1 through 100", () => {
    const tool = requireTool(registerExtensionTools(), "explorers_tx_history");

    expect(Value.Check(tool.parameters, { address: "address", limit: 1 })).toBe(true);
    expect(Value.Check(tool.parameters, { address: "address", limit: 100 })).toBe(true);
    expect(Value.Check(tool.parameters, { address: "address", limit: 0 })).toBe(false);
    expect(Value.Check(tool.parameters, { address: "address", limit: 101 })).toBe(false);
    expect(Value.Check(tool.parameters, { address: "address", limit: 1.5 })).toBe(false);
  });

  it("declares a non-negative integer block number", () => {
    const tool = requireTool(registerExtensionTools(), "explorers_block");

    expect(Value.Check(tool.parameters, { blockNumber: 0 })).toBe(true);
    expect(Value.Check(tool.parameters, { blockNumber: 21000000 })).toBe(true);
    expect(Value.Check(tool.parameters, { blockNumber: -1 })).toBe(false);
    expect(Value.Check(tool.parameters, { blockNumber: 1.5 })).toBe(false);
    expect(Value.Check(tool.parameters, { blockNumber: "1" })).toBe(false);
  });

  it("removes terminal control sequences from rendered arguments", () => {
    const tool = requireTool(registerExtensionTools(), "explorers_balance");
    const renderCall = tool.renderCall;
    if (!renderCall) throw new Error("explorers_balance has no call renderer");

    type RenderCall = NonNullable<ToolDefinition["renderCall"]>;
    type RenderTheme = Parameters<RenderCall>[1];
    const attack = "safe\u001b]52;c;SGVsbG8=\u0007address";
    const rendered = renderCall({ address: attack }, {} as RenderTheme)
      .render(120)
      .join("\n");

    expect(rendered).toContain("safe]52;c;SGVsbG8=address");
    /* oxlint-disable-next-line no-control-regex */
    expect(rendered).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u);
  });

  it("lists providers without model or network access", async () => {
    const tool = requireTool(registerExtensionTools(), "explorers_providers");

    const result = await tool.execute("test", {}, undefined, undefined, unusedContext);

    expect(result.content).toEqual([
      {
        type: "text",
        text: expect.stringMatching(/^Registered providers \(10\):/),
      },
    ]);
  });

  it.each([
    ["explorers_tx_detail", { hash: "0xdead", provider: "aptos" }, "getTxDetail"],
    ["explorers_contract", { address: "0x1", provider: "aptos" }, "getContractInfo"],
    ["explorers_tokens", { address: "0x1", provider: "aptos" }, "getTokenBalances"],
    ["explorers_token_transfers", { address: "0x1", provider: "aptos" }, "getTokenTransfers"],
    ["explorers_gas", { provider: "aptos" }, "getGasData"],
    ["explorers_block", { blockNumber: 1, provider: "aptos" }, "getBlockInfo"],
  ])("reports unsupported %s execution as an error", async (name, params, operation) => {
    const tool = requireTool(registerExtensionTools(), name);

    await expect(
      tool.execute("test", params, undefined, undefined, unusedContext),
    ).rejects.toMatchObject({
      name: "UnsupportedOperationError",
      message: `Operation "${operation}" not supported by aptos`,
      provider: "aptos",
    });
  });

  it("describes contract output without promising ABI or source content", () => {
    const tool = requireTool(registerExtensionTools(), "explorers_contract");

    expect(tool.description).toBe("Get smart-contract metadata, verification, and proxy status");
    expect(tool.promptGuidelines?.join(" ")).not.toMatch(/\b(?:ABI|source)\b/i);
  });
  it("renders structured transaction details in the TUI", () => {
    const tool = requireTool(registerExtensionTools(), "explorers_tx_detail");
    const renderResult = tool.renderResult;
    if (!renderResult) throw new Error("explorers_tx_detail has no result renderer");

    const transaction: Transaction = {
      hash: "0xabc",
      blockNumber: 123,
      from: "0xfrom",
      to: "0xto",
      value: "1000000000000000000",
      valueFormatted: "1 ETH",
      fee: "21000000000000",
      status: "success",
      functionName: "transfer",
      isContractInteraction: true,
      tokenTransfers: [],
    };
    type RenderResult = NonNullable<ToolDefinition["renderResult"]>;
    type RenderTheme = Parameters<RenderResult>[2];
    type RenderContext = Parameters<RenderResult>[3];
    const theme = {
      fg: (_color: string, text: string) => text,
    } as unknown as RenderTheme;

    const component = renderResult(
      {
        content: [{ type: "text", text: "LLM output" }],
        details: { provider: "mempool", transaction },
      },
      { expanded: true, isPartial: false },
      theme,
      // SAFETY: the renderer does not read ToolRenderContext.
      {} as RenderContext,
    );

    expect(component.render(120).map((line) => line.trimEnd())).toEqual([
      "[mempool] 0xabc",
      "Block 123  Status success",
      "Value 1 ETH",
      "Fee 21000000000000 base units",
      "From 0xfrom",
      "To 0xto",
      "Method transfer",
    ]);
  });
  it("strips control bytes from explorer-supplied transaction fields", () => {
    const tool = requireTool(registerExtensionTools(), "explorers_tx_detail");
    const renderResult = tool.renderResult;
    if (!renderResult) throw new Error("explorers_tx_detail has no result renderer");

    // SAFETY: simulates an untrusted explorer violating the declared numeric response type.
    const transaction = {
      hash: "0xabc",
      blockNumber: "123\u001b]52;c;SGVsbG8=\u0007",
      from: "0xfrom",
      to: "0xto",
      value: "1000000000000000000",
      valueFormatted: "1 ETH",
      status: "success",
      isContractInteraction: false,
      tokenTransfers: [],
      opReturn: [
        {
          hex: "6869",
          text: `hi${String.fromCodePoint(0x1b)}]52;c;SGVsbG8=${String.fromCodePoint(0x07)}`,
        },
        { hex: "6f6e650a74776f", text: "one\nStatus: forged" },
      ],
    } as unknown as Transaction;
    type RenderResult = NonNullable<ToolDefinition["renderResult"]>;
    type RenderTheme = Parameters<RenderResult>[2];
    type RenderContext = Parameters<RenderResult>[3];
    const theme = {
      fg: (_color: string, text: string) => text,
    } as unknown as RenderTheme;

    const rendered = renderResult(
      {
        content: [{ type: "text", text: "LLM output" }],
        details: { provider: "mempool", transaction },
      },
      { expanded: true, isPartial: false },
      theme,
      // SAFETY: the renderer does not read ToolRenderContext.
      {} as RenderContext,
    )
      .render(120)
      .map((line) => line.trimEnd());

    expect(rendered).toEqual([
      "[mempool] 0xabc",
      "Block 123]52;c;SGVsbG8=  Status success",
      "Value 1 ETH",
      "From 0xfrom",
      "To 0xto",
      "OP_RETURN hi]52;c;SGVsbG8=",
      "OP_RETURN one",
      "  Status: forged",
    ]);
    /* oxlint-disable-next-line no-control-regex */
    expect(rendered.join("\n")).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u);
  });
});
