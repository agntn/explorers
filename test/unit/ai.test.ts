import { generateText, isStepCount } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vite-plus/test";
import { explorersAiTools } from "../../src/ai.ts";
import { explorersTools } from "../../src/tools.ts";

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

const xrpAddress = "rDsbeomae4FXwgQTJp9Rs64Qg9vDiTCdBv";

/* A model that calls one tool with the given input, then says it's done. */
function scriptedModel(toolName: string, input: object): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doGenerate: [
      {
        content: [
          { type: "tool-call", toolCallId: "call-0", toolName, input: JSON.stringify(input) },
        ],
        finishReason: { unified: "tool-calls", raw: undefined },
        usage,
        warnings: [],
      },
      {
        content: [{ type: "text", text: "done" }],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      },
    ],
  });
}

/* Runs one scripted tool call through generateText and hands back what the step produced. */
async function callThroughModel(toolName: string, input: object): Promise<readonly unknown[]> {
  const result = await generateText({
    model: scriptedModel(toolName, input),
    tools: explorersAiTools(),
    stopWhen: isStepCount(2),
    prompt: "check the wallet",
  });
  return result.steps[0]?.content ?? [];
}

/* Calls one tool the way the AI SDK does, with the abort signal the app passed. */
async function runTool(name: string, input: object, abortSignal: AbortSignal): Promise<unknown> {
  const tool = Object.entries(explorersAiTools()).find(([key]) => key === name)?.[1];
  if (tool?.execute === undefined) throw new Error(`No executable AI SDK tool ${name}`);
  return await tool.execute(input, { toolCallId: name, messages: [], context: {}, abortSignal });
}

describe("@agntn/explorers/ai", () => {
  it("offers every tool MCP, Pi and OMP list, under the same name and in the same order", () => {
    expect(Object.keys(explorersAiTools())).toEqual(explorersTools().map((tool) => tool.name));
  });

  it("hands the model the same compact JSON an MCP client reads", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ Account: xrpAddress, Balance: "21522872904801" }),
    );
    vi.stubGlobal("fetch", fetch);

    const [, toolResult] = await callThroughModel("explorers_balance", { address: xrpAddress });

    expect(toolResult).toMatchObject({ type: "tool-result", toolName: "explorers_balance" });
    const output = (toolResult as { output: { text: string } }).output;
    expect(JSON.parse(output.text)).toMatchObject({
      provider: "xrpscan",
      data: { chain: "xrpl", balance: "21522872904801", balanceFormatted: "21522872.904801" },
    });
    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      `https://api.xrpscan.com/api/v1/account/${xrpAddress}`,
    );
  });

  it("turns away input the schema rejects before any explorer hears of it", async () => {
    const [, toolError] = await callThroughModel("explorers_block", { blockNumber: "tip" });

    expect(toolError).toMatchObject({ type: "tool-error", toolName: "explorers_block" });
    expect(String((toolError as { error: unknown }).error)).toContain("blockNumber");
  });

  it("reports a refused read as a tool error that names who could answer", async () => {
    const [, toolError] = await callThroughModel("explorers_block", {
      blockNumber: 1,
      chain: "aptos",
      provider: "aptos",
    });

    expect(toolError).toMatchObject({ type: "tool-error", toolName: "explorers_block" });
    expect(String((toolError as { error: unknown }).error)).toContain(
      'Operation "getBlockInfo" not supported by aptos; no provider serves this read on aptos',
    );
  });

  it("aborts the explorer request with the AI SDK abort signal", async () => {
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (_input: string | URL | Request, init?: RequestInit) =>
          await new Promise<Response>((_resolve, reject) => {
            if (init?.signal) signals.push(init.signal);
            init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
              once: true,
            });
          }),
      ),
    );
    const controller = new AbortController();

    const call = runTool(
      "explorers_balance",
      { address: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh", chain: "bitcoin" },
      controller.signal,
    ).catch((error: unknown) => error);
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    controller.abort();

    await call;
    expect(signals[0]?.aborted).toBe(true);
  });
});
