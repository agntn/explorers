/** Run the Explorers MCP server over stdio */
import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "mcp",
    description: "Run the Explorers MCP server over stdio",
  },
  async run() {
    // The SDK and its zod schemas cost more than a megabyte to parse, so they wait until the
    // server actually starts instead of loading for every `--help`.
    const [{ StdioServerTransport }, { createMcpServer }] = await Promise.all([
      import("@modelcontextprotocol/sdk/server/stdio.js"),
      import("../mcp.js"),
    ]);
    const server = createMcpServer();
    await server.connect(new StdioServerTransport());
  },
});
