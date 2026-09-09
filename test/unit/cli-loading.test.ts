/// <reference types="node" />
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function runCLI(args: readonly string[], prelude = "") {
  return spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `
${prelude}
process.argv = [process.execPath, "explorers", ...${JSON.stringify(args)}];
await import("./src/cli.ts");
`,
    ],
    {
      cwd: new URL("../../", import.meta.url),
      encoding: "utf8",
      timeout: 10_000,
      env: { ...process.env, CONSOLA_LEVEL: "3" },
    },
  );
}

const offline = `
globalThis.fetch = async () => { throw new Error("Unexpected network request"); };
`;

describe("CLI loading", () => {
  it.each([
    "",
    "balance",
    "tx",
    "contract",
    "tokens",
    "transfers",
    "gas",
    "block",
    "providers",
    "mcp",
  ])("prints help without loading backends: explorers %s", (command) => {
    const result = runCLI(
      command ? [command, "--help"] : ["--help"],
      `
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
const backends = [];
registerHooks({ load(url, context, nextLoad) {
  if (url.includes("/src/core/") || url.includes("/src/providers/") ||
      url.includes("/ofetch/") || url.includes("/@agntn/chains/") ||
      url.includes("/@modelcontextprotocol/sdk/")) backends.push(url);
  return nextLoad(url, context);
}});
process.once("exit", () => assert.deepEqual(backends, []));
${offline}
`,
    );
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("USAGE");
  });

  it.each([
    ["balance", "address"],
    ["tx", "address"],
    ["contract", "address"],
    ["tokens", "address"],
    ["transfers", "address"],
    ["gas"],
    ["block", "0"],
  ])("loads validation when executing %s", (...command) => {
    const result = runCLI([...command, "--chain", "not-a-chain"], offline);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("not-a-chain");
    expect(result.stderr).not.toContain("Unexpected network request");
  });

  it("loads the registry when listing providers", () => {
    const result = runCLI(["providers"], offline);
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Registered providers");
    expect(result.stdout).toContain("mempool: balances, txHistory");
  });

  it.each([
    [["balance", "bc1qexample", "--provider", "mempool"], "0.00001 BTC"],
    [["tx", "bc1qexample", "--provider", "mempool", "--mode", "history"], "0 transactions"],
    [["tx", "a".repeat(64), "--provider", "mempool"], "Value: 0.00001"],
  ] as const)("executes reads after loading the backend: %j", (args, expected) => {
    const result = runCLI(
      args,
      `
globalThis.fetch = async (input) => {
  const url = String(input);
  if (url.endsWith("/tx/" + "a".repeat(64))) return Response.json({
    txid: "a".repeat(64), fee: 100, vin: [],
    vout: [{ scriptpubkey_address: "bc1qrecipient", value: 1000 }],
    status: { confirmed: true, block_height: 1000, block_time: 1700000000 },
  });
  if (url.endsWith("/address/bc1qexample/txs")) return new Response("[]");
  if (url.endsWith("/address/bc1qexample")) return Response.json({
    chain_stats: { funded_txo_sum: 1000, spent_txo_sum: 0, tx_count: 0 },
    mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 },
  });
  throw new Error("Unexpected network request: " + url);
};
`,
    );
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(expected);
  });
});
