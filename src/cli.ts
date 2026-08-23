/** Explorers CLI — unified block explorer commands */
import { defineCommand, runMain } from "citty";
import { normalizeMainArgs } from "./cli-args.js";
import { version } from "./version.js";

// Side-effect: register all providers on import
import "./providers/index.js";

const main = defineCommand({
  meta: {
    name: "explorers",
    version,
    description: "Unified multi-chain block explorer CLI",
  },
  subCommands: {
    balance: () => import("./commands/balance.js").then((m) => m.default),
    tx: () => import("./commands/tx.js").then((m) => m.default),
    contract: () => import("./commands/contract.js").then((m) => m.default),
    tokens: () => import("./commands/tokens.js").then((m) => m.default),
    transfers: () => import("./commands/transfers.js").then((m) => m.default),
    gas: () => import("./commands/gas.js").then((m) => m.default),
    block: () => import("./commands/block.js").then((m) => m.default),
    providers: () => import("./commands/providers.js").then((m) => m.default),
    mcp: () => import("./commands/mcp.js").then((m) => m.default),
  },
});

runMain(main, { rawArgs: normalizeMainArgs(process.argv.slice(2)) });
