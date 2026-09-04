import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as TypeBox from "@oh-my-pi/omptype/typebox";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@oh-my-pi/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
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

interface ToolLookup {
  readonly get: (name: string) => ToolDefinition | undefined;
}

function requireTool(tools: ToolLookup, name: string): ToolDefinition {
  const tool = tools.get(name);
  if (!tool) throw new Error(`Tool not registered: ${name}`);
  return tool;
}

interface ToolContentView {
  readonly type: string;
  readonly text?: string;
}

interface ToolResultView {
  readonly content: readonly ToolContentView[];
  readonly isError: boolean;
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function parseToolResult(value: unknown): ToolResultView {
  if (typeof value !== "object" || value === null || !("content" in value)) {
    throw new TypeError("Tool returned no content array");
  }
  const contentValue = value.content;
  if (!isUnknownArray(contentValue)) throw new TypeError("Tool content is not an array");

  const content = contentValue.map((part): ToolContentView => {
    if (typeof part !== "object" || part === null || !("type" in part)) {
      throw new TypeError("Tool content item has no type");
    }
    const type = part.type;
    const text = "text" in part ? part.text : undefined;
    if (typeof type !== "string" || (text !== undefined && typeof text !== "string")) {
      throw new TypeError("Tool content item has an invalid shape");
    }
    return { type, text };
  });
  return { content, isError: "isError" in value && value.isError === true };
}

function textContaining(expected: string): unknown {
  return expect.stringContaining(expected);
}

function textMatching(expected: RegExp): unknown {
  return expect.stringMatching(expected);
}

function accepts(tool: ToolDefinition, value: unknown): boolean {
  // SAFETY: the test host injects OMP's TypeBox facade, which creates this schema.
  return (tool.parameters as unknown as TypeBox.TSchema).safeParse(value).success;
}

// SAFETY: the tested execute functions do not read ExtensionContext.
const unusedContext = {} as ExtensionContext;

describe("explorers OMP extension", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("loads its sibling dist instead of another installed package copy", () => {
    const root = mkdtempSync(join(tmpdir(), "explorers-omp-loader-"));

    try {
      const packageRoot = join(root, "package");
      const extensionDir = join(packageRoot, "packages/omp/extensions");
      writeFileSync(join(root, "package.json"), '{"type":"module"}\n');
      const installedPackageDir = join(packageRoot, "node_modules/@agntn/explorers");
      mkdirSync(extensionDir, { recursive: true });
      mkdirSync(join(packageRoot, "dist"), { recursive: true });
      mkdirSync(installedPackageDir, { recursive: true });
      copyFileSync(
        fileURLToPath(new URL("../../packages/omp/extensions/explorers.ts", import.meta.url)),
        join(extensionDir, "explorers.ts"),
      );
      writeFileSync(
        join(packageRoot, "dist/index.mjs"),
        'export function providers() { return ["relative-dist"]; }\n',
      );
      writeFileSync(
        join(installedPackageDir, "package.json"),
        '{"name":"@agntn/explorers","type":"module","exports":"./index.mjs"}\n',
      );
      writeFileSync(
        join(installedPackageDir, "index.mjs"),
        'export function providers() { return ["poisoned-bare-import"]; }\n',
      );
      const probePath = join(root, "probe.ts");
      writeFileSync(
        probePath,
        `import extension from "./package/packages/omp/extensions/explorers.ts";
const tools = new Map<string, any>();
extension({
  pi: { Text: class {} },
  typebox: { Type: new Proxy({}, { get: () => () => ({}) }) },
  setLabel() {},
  registerTool(tool: any) { tools.set(tool.name, tool); },
} as any);
const result = await tools.get("explorers_providers").execute();
console.log(result.content[0].text);
`,
      );

      const tsx = fileURLToPath(new URL("../../node_modules/.bin/tsx", import.meta.url));
      const output = execFileSync(tsx, [probePath], { cwd: root, encoding: "utf8" });
      expect(output).toBe("Registered providers (1):\n  relative-dist\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

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

  it("accepts one address or a non-empty list of addresses for balance", () => {
    const tool = requireTool(registerExtensionTools().tools, "explorers_balance");

    expect(accepts(tool, { address: "address" })).toBe(true);
    expect(accepts(tool, { address: ["a1", "a2"] })).toBe(true);
    expect(accepts(tool, { address: [] })).toBe(false);
    expect(accepts(tool, { address: "" })).toBe(false);
    expect(accepts(tool, { address: [""] })).toBe(false);
    expect(accepts(tool, { address: "   " })).toBe(false);
    expect(accepts(tool, { address: ["   "] })).toBe(false);
    expect(accepts(tool, { address: "  0xabc  " })).toBe(true);
  });

  it("resolves ENS before returning dated balance context", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-08-28T12:34:56.789Z");
    const resolved = "0x" + "a".repeat(40);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const payload = url.includes("ensideas")
          ? { address: resolved }
          : { coin_balance: "1000000000000000000" };
        return new Response(JSON.stringify(payload), {
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const tool = requireTool(registerExtensionTools().tools, "explorers_balance");

    const result = parseToolResult(
      await tool.execute(
        "test",
        { address: "vitalik.eth", provider: "blockscout" },
        undefined,
        undefined,
        unusedContext,
      ),
    );

    expect(result.content).toEqual([
      {
        type: "text",
        text: `[blockscout] ethereum balance for ${resolved}: 1 ETH (1000000000000000000 base units; fetched 2026-08-28T12:34:56.789Z; block unknown)`,
      },
    ]);
  });

  it("resolves ENS for transaction, contract, and token lookups", async () => {
    const resolved = `0x${"a".repeat(40)}`;
    const explorerUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("ensideas")) {
          return new Response(JSON.stringify({ address: resolved }), {
            headers: { "content-type": "application/json" },
          });
        }
        explorerUrls.push(url);
        const payload = url.endsWith("token-balances")
          ? []
          : url.includes("/smart-contracts/")
            ? { is_verified: false }
            : { items: [] };
        return new Response(JSON.stringify(payload), {
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const { tools } = registerExtensionTools();

    for (const name of [
      "explorers_tx_history",
      "explorers_contract",
      "explorers_tokens",
      "explorers_token_transfers",
    ]) {
      const tool = requireTool(tools, name);
      await tool.execute(
        "test",
        { address: "vitalik.eth", chain: "ethereum", provider: "blockscout" },
        undefined,
        undefined,
        unusedContext,
      );
    }

    expect(explorerUrls).toHaveLength(4);
    for (const url of explorerUrls) expect(url).toContain(resolved);
  });

  it("falls past an automatically selected provider's rate limit", async () => {
    vi.stubEnv("ETHERSCAN_API_KEY", "configured");
    vi.stubEnv("BLOCKCHAIR_API_KEY", "");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const payload = String(input).includes("etherscan.io")
          ? { status: "0", message: "NOTOK", result: "Max rate limit reached" }
          : { coin_balance: "1" };
        return new Response(JSON.stringify(payload), {
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const tool = requireTool(registerExtensionTools().tools, "explorers_balance");

    const result = parseToolResult(
      await tool.execute(
        "test",
        {
          address: "0x0000000000000000000000000000000000000001",
          chain: "ethereum",
        },
        undefined,
        undefined,
        unusedContext,
      ),
    );

    expect(result.content).toEqual([
      {
        type: "text",
        text: textContaining("[blockscout] ethereum balance"),
      },
    ]);
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
    const attack = "safe\u001B]52;c;SGVsbG8=\u0007address";
    const component = renderCall(
      { address: attack },
      { expanded: false, isPartial: false },
      {} as RenderTheme,
    );
    const rendered = component.render(120).join("\n");

    expect(rendered).toContain("safe]52;c;SGVsbG8=address");
    // oxlint-disable-next-line no-control-regex -- The assertion proves terminal control bytes were removed.
    expect(rendered).not.toMatch(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/u);
  });

  it("lists providers without model or network access", async () => {
    const tool = requireTool(registerExtensionTools().tools, "explorers_providers");

    const result = parseToolResult(
      await tool.execute("test", {}, undefined, undefined, unusedContext),
    );

    expect(result.content).toEqual([
      {
        type: "text",
        text: textMatching(/^Registered providers \(12\):/),
      },
    ]);
  });

  it("keeps complete identifiers in transaction history results", async () => {
    const address = "bc1qsenderaddress";
    const recipient = "bc1qrecipientaddress";
    const hash = "a".repeat(64);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([
              {
                txid: hash,
                vin: [{ prevout: { scriptpubkey_address: address, value: 100_000 } }],
                vout: [{ scriptpubkey_address: recipient, value: 99_000 }],
                fee: 1_000,
                status: { confirmed: true, block_height: 1, block_time: 1 },
              },
            ]),
            { headers: { "Content-Type": "application/json" } },
          ),
      ),
    );
    const tool = requireTool(registerExtensionTools().tools, "explorers_tx_history");

    const result = parseToolResult(
      await tool.execute(
        "test",
        { address, chain: "bitcoin", provider: "mempool", limit: 1 },
        undefined,
        undefined,
        unusedContext,
      ),
    );
    const text = result.content.find((part) => part.type === "text")?.text ?? "";

    expect(text).toBe(
      `[mempool] 1 transactions on bitcoin:\n${hash} ${address}→${recipient} 0.00099 [success]`,
    );
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
      "Get smart contract verification, compiler, token, creator, and proxy metadata for an address or ENS name from the selected explorer.",
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
      blockNumber: "123\u001B]52;c;SGVsbG8=\u0007",
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
    expect(rendered.join("\n")).not.toMatch(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/u);
  });
});
