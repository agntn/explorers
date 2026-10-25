#!/usr/bin/env node
/** Explorers CLI: a command per explorer tool, `balance` for a bare address, and `mcp`. */
import { existsSync } from "node:fs";
import { sep } from "node:path";
import { fileURLToPath } from "node:url";
import type * as McpCommand from "./commands/mcp.ts";

/* The same file from `src/cli.ts` and `dist/cli.mjs`; the npm package ships only `dist`. */
const sourceMcpCommand = new URL("../src/commands/mcp.ts", import.meta.url);

/* Narrow the namespace a runtime URL import returns, which TypeScript types as `any`. */
function isMcpModule(value: unknown): value is typeof McpCommand {
  return typeof value === "object" && value !== null && "serveMcp" in value;
}

/**
 * Load the MCP command. The built bin inside a checkout runs the live source, as the Pi and OMP
 * extensions do, so a local server takes a change on restart instead of `pnpm build`. Node refuses
 * to strip types under `node_modules`, so a copy there keeps the bundle, and so does the npm
 * package, which ships no `src`. `EXPLORERS_DIST=1` keeps it everywhere.
 *
 * @returns {Promise<typeof McpCommand>} The module that starts the stdio server.
 */
async function loadMcpCommand(): Promise<typeof McpCommand> {
  const sourcePath = fileURLToPath(sourceMcpCommand);
  const fromSource =
    !import.meta.url.endsWith(".ts") &&
    process.env.EXPLORERS_DIST !== "1" &&
    !sourcePath.includes(`${sep}node_modules${sep}`) &&
    existsSync(sourcePath);
  if (!fromSource) return import("./commands/mcp.ts");
  const module: unknown = await import(sourceMcpCommand.href);
  if (!isMcpModule(module)) throw new TypeError(`${sourcePath} has no serveMcp`);
  return module;
}

const argv = process.argv.slice(2);

/** `explorers mcp` serves straight away, and a stray flag from a client config doesn't stop it. */
const servesMcp = argv[0] === "mcp" && !argv.some((word) => word === "--help" || word === "-h");

if (servesMcp) {
  await (await loadMcpCommand()).serveMcp();
} else {
  await (await import("./cli-run.ts")).runExplorersCli(argv);
}
