import type { McpServerInfo } from "@agntn/tools/mcp";
import { version } from "./version.ts";

/** How the MCP server introduces itself, kept off `mcp.ts` so the CLI loads no SDK for it. */
export const serverInfo = {
  name: "explorers",
  title: "Explorers",
  version,
  description:
    "Balances, transactions, unspent outputs, tokens, contracts, gas and blocks from block explorers across Bitcoin, EVM chains, Solana, Stellar, XRP and more, in one shape. Ask what an address holds, not which API to ask.",
  websiteUrl: "https://explorers.agntn.dev",
  icons: [
    { src: "https://explorers.agntn.dev/favicon.svg", mimeType: "image/svg+xml", sizes: ["any"] },
    { src: "https://explorers.agntn.dev/icon-512.png", mimeType: "image/png", sizes: ["512x512"] },
  ],
} satisfies McpServerInfo;
