import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@oh-my-pi/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import explorersOmpExtension from "../../extensions/omp/explorers.ts";
import "../../src/providers/index.ts";
import { explorersTools } from "../../src/tools.ts";

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

/* Registers the extension against a host whose `Type.Unsafe` hands the schema back unchanged. */
async function registerExtensionTools(): Promise<RegisteredExtension> {
  const tools = new Map<string, ToolDefinition>();
  let label: string | undefined;
  const api = {
    pi: { Text: TestText },
    typebox: { Type: { Unsafe: (schema: unknown) => schema } },
    setLabel(value: string) {
      label = value;
    },
    registerTool(tool: ToolDefinition) {
      tools.set(tool.name, tool);
    },
  };

  // SAFETY: the test host implements what the adapter calls while it registers the tools.
  await explorersOmpExtension(api as unknown as ExtensionAPI);
  return { label, tools };
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

/* The text of a tool result. */
function textOf(result: unknown): string {
  const content = (result as { content: Array<{ text?: string }> }).content;
  return content[0]?.text ?? "";
}

// SAFETY: the tested execute functions do not read ExtensionContext.
const unusedContext = {} as ExtensionContext;

type RenderTheme = Parameters<NonNullable<ToolDefinition["renderResult"]>>[2];

/* A theme that draws text as it is, so a test reads exactly what the renderer composed. */
const plainTheme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as RenderTheme;

describe("explorers OMP extension", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("loads its sibling dist instead of another installed package copy", () => {
    const root = mkdtempSync(join(tmpdir(), "explorers-omp-loader-"));

    try {
      const packageRoot = join(root, "package");
      const extensionDir = join(packageRoot, "extensions/omp");
      writeFileSync(join(root, "package.json"), '{"type":"module"}\n');
      const installedPackageDir = join(packageRoot, "node_modules/@agntn/explorers");
      mkdirSync(extensionDir, { recursive: true });
      mkdirSync(join(packageRoot, "dist"), { recursive: true });
      mkdirSync(installedPackageDir, { recursive: true });
      symlinkSync(
        realpathSync(fileURLToPath(new URL("../../node_modules/@agntn/tools", import.meta.url))),
        join(packageRoot, "node_modules/@agntn/tools"),
      );
      copyFileSync(
        fileURLToPath(new URL("../../extensions/omp/explorers.ts", import.meta.url)),
        join(extensionDir, "explorers.ts"),
      );
      writeFileSync(
        join(packageRoot, "dist/tools.mjs"),
        `import { defineTool, Type } from "@agntn/tools";
export const describeCall = () => "";
export const terminalLines = () => [];
export const explorersTools = () => [defineTool({
  name: "explorers_providers", title: "List Explorer Providers", description: "List",
  effect: "read", input: Type.Object({}),
  execute: () => ({ content: [{ type: "text", text: "relative-dist" }], details: {} }),
})];
`,
      );
      writeFileSync(
        join(installedPackageDir, "package.json"),
        '{"name":"@agntn/explorers","type":"module","exports":"./index.mjs"}\n',
      );
      writeFileSync(
        join(installedPackageDir, "index.mjs"),
        'throw new Error("poisoned bare import");\n',
      );
      const probePath = join(root, "probe.ts");
      writeFileSync(
        probePath,
        `import extension from "./package/extensions/omp/explorers.ts";
const tools = new Map<string, any>();
await extension({
  pi: { Text: class {} },
  typebox: { Type: { Unsafe: (schema: unknown) => schema } },
  setLabel() {},
  registerTool(tool: any) { tools.set(tool.name, tool); },
} as any);
const result = await tools.get("explorers_providers").execute("probe", {}, undefined, undefined, {});
console.log(result.content[0].text);
`,
      );

      const tsx = fileURLToPath(new URL("../../node_modules/.bin/tsx", import.meta.url));
      const output = execFileSync(tsx, [probePath], { cwd: root, encoding: "utf8" });
      expect(output).toBe("relative-dist\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("registers the shared definitions read-only under an extension label", async () => {
    const { label, tools } = await registerExtensionTools();

    expect(label).toBe("Explorers");
    expect([...tools.keys()]).toEqual(explorersTools().map((tool) => tool.name));
    for (const tool of tools.values()) {
      const shared = explorersTools().find((candidate) => candidate.name === tool.name);
      expect(tool.approval).toBe("read");
      expect(tool.label).toBe(shared?.title);
      expect(tool.parameters).toEqual(shared?.input);
    }
  });

  it("lets OMP drop a blank text filler and keep a zero number, which reads as the default", () => {
    const schema = explorersTools().find((tool) => tool.name === "explorers_token_transfers")?.input
      .properties as Record<string, { minLength?: number; minimum?: number }>;

    for (const field of ["chain", "provider", "token", "sort"]) {
      expect(schema[field]?.minLength).toBe(1);
    }
    for (const field of ["limit", "page", "startBlock", "endBlock"]) {
      expect(schema[field]?.minimum).toBe(0);
    }
  });

  it("reads a zero limit and page OMP fills in as the defaults", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ items: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const tool = requireTool((await registerExtensionTools()).tools, "explorers_token_transfers");

    await tool.execute(
      "test",
      {
        address: "0x0000000000000000000000000000000000000001",
        chain: "ethereum",
        provider: "blockscout",
        limit: 0,
        page: 0,
        startBlock: 0,
        endBlock: 0,
      },
      undefined,
      undefined,
      unusedContext,
    );

    const [url] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toContain("/token-transfers?type=ERC-20");
    expect(String(url)).not.toContain("token=");
  });

  it("hands the model compact JSON and draws the answer from its details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json([
          {
            txid: "a".repeat(64),
            vout: 0,
            value: 1000,
            status: { confirmed: true, block_height: 1, block_time: 1 },
          },
        ]),
      ),
    );
    const tool = requireTool((await registerExtensionTools()).tools, "explorers_utxos");

    const result = await tool.execute(
      "test",
      { address: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq" },
      undefined,
      undefined,
      unusedContext,
    );
    const rendered = tool
      .renderResult?.(result, { expanded: false, isPartial: false }, plainTheme, {} as never)
      .render(200)
      .join("\n");

    expect(JSON.parse(textOf(result))).toMatchObject({
      provider: "mempool",
      total: 1,
      confirmed: "1000",
    });
    expect(rendered).toBe(
      `[mempool] 1 unspent outputs, 1000 base units confirmed:\n  ${"a".repeat(64)}:0  0.00001 (1000 base units)  [block 1]`,
    );
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
    const tool = requireTool((await registerExtensionTools()).tools, "explorers_balance");
    const controller = new AbortController();

    const call = Promise.resolve(
      tool.execute(
        "test",
        { address: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh", chain: "bitcoin" },
        controller.signal,
        undefined,
        unusedContext,
      ),
    ).catch((error: unknown) => error);
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    controller.abort();

    await call;
    expect(signals[0]?.aborted).toBe(true);
  });

  it("reports an operation the provider lacks as an error naming who serves it", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const tool = requireTool((await registerExtensionTools()).tools, "explorers_utxos");

    const outcome = await Promise.resolve(
      tool.execute(
        "test",
        {
          address: "qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a",
          chain: "bch",
          provider: "blockchair",
        },
        undefined,
        undefined,
        unusedContext,
      ),
    ).then(
      (result) => textOf(result),
      (error: unknown) => String(error),
    );

    expect(outcome).toContain('Operation "getUtxos" not supported by blockchair; try haskoin');
    expect(fetch).not.toHaveBeenCalled();
  });
});
