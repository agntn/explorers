/**
 * Serves the MCP server over stdio, which owns stdout: anything else printed there breaks the
 * client. The SDK loads here, so `explorers --help` never pays for it.
 *
 * @returns {Promise<void>} Once the transport is connected.
 */
export async function serveMcp(): Promise<void> {
  const [{ createMcpServer }, { StdioServerTransport }] = await Promise.all([
    import("../mcp.ts"),
    import("@modelcontextprotocol/server/stdio"),
  ]);
  await createMcpServer().connect(new StdioServerTransport());
}
