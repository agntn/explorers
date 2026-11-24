/**
 * Serves the MCP server over stdio, which owns stdout: anything else printed there breaks the
 * client. The SDK loads here, so `explorers --help` never pays for it. 2025 or 2026, both get in.
 *
 * @returns {Promise<void>} Once the server listens.
 */
export async function serveMcp(): Promise<void> {
  const [{ createMcpServer }, { serveStdio }] = await Promise.all([
    import("../mcp.ts"),
    import("@modelcontextprotocol/server/stdio"),
  ]);
  serveStdio(() => createMcpServer());
}
