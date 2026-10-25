import { createMcpServer as createToolServer } from "@agntn/tools/mcp";
import type { Server } from "@modelcontextprotocol/server";
import { serverInfo } from "./server-info.ts";
import { explorersTools } from "./tools.ts";

/**
 * Create the MCP server over the explorer tools, exported as `@agntn/explorers/mcp`. Pi, OMP and
 * the CLI get the same definitions; a provider module loads with the first call that needs it.
 *
 * @returns {Server} A server with no transport yet, ready for `connect()`.
 */
export function createMcpServer(): Server {
  return createToolServer(serverInfo, explorersTools());
}
