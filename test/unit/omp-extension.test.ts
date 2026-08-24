import * as TypeBox from "@oh-my-pi/omptype/typebox";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@oh-my-pi/pi-coding-agent";
import { describe, expect, it } from "vitest";
import explorersOmpExtension from "../../packages/omp/extensions/explorers.js";
import type { Transaction } from "../../src/core/types.js";

class TestText {
  constructor(private readonly text: string) {}

  render(): readonly string[] {
    return this.text.split("\n");
  }
}

interface RegisteredExtension {
  label: string | undefined;
  tools: Map<string, ToolDefinition>;
}

function registerExtensionTools(): RegisteredExtension {
  const tools = new Map<string, ToolDefinition>();
  let label: string | undefined;
  const api = {
    pi: { Text: TestText },
    typebox: TypeBox,
    setLabel(value: string) {
      label = value;
    },
    registerTool(tool: ToolDefinition) {
      tools.set(tool.name, tool);
    },
  };

  // SAFETY: the test host implements the four registration-time capabilities used by the extension.
  explorersOmpExtension(api as unknown as ExtensionAPI);
  return { label, tools };
}

function requireTool(tools: Map<string, ToolDefinition>, name: string): ToolDefinition {
  const tool = tools.get(name);
  if (!tool) throw new Error(`Tool not registered: ${name}`);
  return tool;
}

function accepts(tool: ToolDefinition, value: unknown): boolean {
  // SAFETY: the test host injects OMP's TypeBox facade, which creates this schema.
  return (tool.parameters as unknown as TypeBox.TSchema).safeParse(value).success;
}

// SAFETY: the tested execute functions do not read ExtensionContext.
const unusedContext = {} as ExtensionContext;

describe("explorers OMP extension", () => {
  it("registers the complete read-only tool set under an extension label", () => {
    const { label, tools } = registerExtensionTools();

    expect(label).toBe("Explorers");
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
    for (const tool of tools.values()) expect(tool.approval).toBe("read");
  });

  it("declares an integer transaction-history limit from 1 through 100", () => {
    const tool = requireTool(registerExtensionTools().tools, "explorers_tx_history");

    expect(accepts(tool, { address: "address", limit: 1 })).toBe(true);
    expect(accepts(tool, { address: "address", limit: 100 })).toBe(true);
    expect(accepts(tool, { address: "address", limit: 0 })).toBe(false);
    expect(accepts(tool, { address: "address", limit: 101 })).toBe(false);
    expect(accepts(tool, { address: "address", limit: 1.5 })).toBe(false);
  });

  it("declares a non-negative integer block number", () => {
    const tool = requireTool(registerExtensionTools().tools, "explorers_block");

    expect(accepts(tool, { blockNumber: 0 })).toBe(true);
    expect(accepts(tool, { blockNumber: 21000000 })).toBe(true);
    expect(accepts(tool, { blockNumber: -1 })).toBe(false);
    expect(accepts(tool, { blockNumber: 1.5 })).toBe(false);
    expect(accepts(tool, { blockNumber: "1" })).toBe(false);
  });

  it("documents environment-based provider selection accurately", () => {
    const tool = requireTool(registerExtensionTools().tools, "explorers_balance");

    expect(tool.description).toContain("configured API keys");
    expect(tool.description).toContain("falls back to Blockscout on Ethereum");
    expect(tool.description).not.toContain("Defaults to Ethereum mainnet");
  });

  it("removes terminal control sequences from rendered arguments", () => {
    const tool = requireTool(registerExtensionTools().tools, "explorers_balance");
    const renderCall = tool.renderCall;
    if (!renderCall) throw new Error("explorers_balance has no call renderer");

    type RenderCall = NonNullable<ToolDefinition["renderCall"]>;
    type RenderTheme = Parameters<RenderCall>[2];
    const attack = "safe\u001b]52;c;SGVsbG8=\u0007address";
    const component = renderCall(
      { address: attack },
      { expanded: false, isPartial: false },
      {} as RenderTheme,
    );
    const rendered = component.render(120).join("\n");

    expect(rendered).toContain("safe]52;c;SGVsbG8=address");
    // oxlint-disable-next-line no-control-regex -- The assertion proves terminal control bytes were removed.
    expect(rendered).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u);
  });

  it("lists providers without model or network access", async () => {
    const tool = requireTool(registerExtensionTools().tools, "explorers_providers");

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
    const tool = requireTool(registerExtensionTools().tools, name);

    await expect(
      tool.execute("test", params, undefined, undefined, unusedContext),
    ).rejects.toMatchObject({
      name: "UnsupportedOperationError",
      message: `Operation "${operation}" not supported by aptos`,
      provider: "aptos",
    });
  });

  it("describes contract output without promising ABI or source content", () => {
    const tool = requireTool(registerExtensionTools().tools, "explorers_contract");

    expect(tool.description).toBe(
      "Get smart-contract verification, compiler, token, creator, and proxy metadata from the selected explorer.",
    );
    expect(tool.description).not.toMatch(/\b(?:ABI|source)\b/i);
  });

  it("renders structured transaction details in the TUI", () => {
    const tool = requireTool(registerExtensionTools().tools, "explorers_tx_detail");
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
      fee: "21000000000000",
      status: "success",
      functionName: "transfer",
      isContractInteraction: true,
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
    );

    const rendered = component.render(120).map((line) => line.trimEnd());
    expect(rendered).toEqual([
      "[mempool] 0xabc",
      "Block 123]52;c;SGVsbG8=  Status success",
      "Value 1 ETH",
      "Fee 21000000000000 base units",
      "From 0xfrom",
      "To 0xto",
      "Method transfer",
      "OP_RETURN hi]52;c;SGVsbG8=",
      "OP_RETURN one",
      "  Status: forged",
    ]);
    // oxlint-disable-next-line no-control-regex -- The assertion proves external result fields were sanitized.
    expect(rendered.join("\n")).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u);
  });
});
