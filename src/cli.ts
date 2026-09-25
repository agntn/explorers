#!/usr/bin/env node
/** Explorers CLI — unified block explorer commands */
import { existsSync } from "node:fs";
import { sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defineCommand, runMain } from "citty";
import { normalizeMainArgs } from "./cli-args.ts";
import type McpCommand from "./commands/mcp.ts";
import { version } from "./version.ts";

/* The same file from `src/cli.ts` and `dist/cli.mjs`; the npm package ships only `dist`. */
const sourceMcpCommand = new URL("../src/commands/mcp.ts", import.meta.url);

/* Narrow the namespace a runtime URL import returns, which TypeScript types as `any`. */
function isMcpModule(value: unknown): value is { default: typeof McpCommand } {
  return typeof value === "object" && value !== null && "default" in value;
}

/**
 * Load the MCP command. The built bin inside a checkout runs the live source, as the Pi and OMP
 * extensions do, so a local server takes a change on restart instead of `pnpm build`. Node refuses
 * to strip types under `node_modules`, so a copy there keeps the bundle, and so does the npm
 * package, which ships no `src`. `EXPLORERS_DIST=1` keeps it everywhere.
 *
 * @returns {Promise<typeof McpCommand>} The citty command that starts the stdio server.
 */
async function loadMcpCommand(): Promise<typeof McpCommand> {
  const sourcePath = fileURLToPath(sourceMcpCommand);
  const fromSource =
    !import.meta.url.endsWith(".ts") &&
    process.env.EXPLORERS_DIST !== "1" &&
    !sourcePath.includes(`${sep}node_modules${sep}`) &&
    existsSync(sourcePath);
  if (!fromSource) return (await import("./commands/mcp.ts")).default;
  const module: unknown = await import(sourceMcpCommand.href);
  if (!isMcpModule(module)) throw new TypeError(`${sourcePath} has no default command`);
  return module.default;
}

/**
 * End the process once the reader of stdout or stderr is gone, as after `| head -1` or a pager that
 * quits early. Node ignores SIGPIPE, so without a listener the next write throws `EPIPE` with a
 * stack trace. The exit code stays whatever the command set.
 *
 * @param {Readonly<NodeJS.ErrnoException>} error The error the stream emitted.
 */
function exitOnClosedPipe(error: Readonly<NodeJS.ErrnoException>): void {
  if (error.code !== "EPIPE") throw error;
  process.exit();
}

process.stdout.on("error", exitOnClosedPipe);
process.stderr.on("error", exitOnClosedPipe);

const main = defineCommand({
  meta: {
    name: "explorers",
    version,
    description: "Unified multi-chain block explorer CLI",
  },
  subCommands: {
    balance: () => import("./commands/balance.ts").then((m) => m.default),
    tx: () => import("./commands/tx.ts").then((m) => m.default),
    utxos: () => import("./commands/utxos.ts").then((m) => m.default),
    contract: () => import("./commands/contract.ts").then((m) => m.default),
    tokens: () => import("./commands/tokens.ts").then((m) => m.default),
    transfers: () => import("./commands/transfers.ts").then((m) => m.default),
    gas: () => import("./commands/gas.ts").then((m) => m.default),
    block: () => import("./commands/block.ts").then((m) => m.default),
    providers: () => import("./commands/providers.ts").then((m) => m.default),
    mcp: loadMcpCommand,
  },
});

void runMain(main, { rawArgs: normalizeMainArgs(process.argv.slice(2)) });
