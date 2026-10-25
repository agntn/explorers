import { runCli } from "@agntn/tools/cli";
import { serverInfo } from "./server-info.ts";
import { explorersCommands, explorersTools } from "./tools.ts";
import { version } from "./version.ts";

/**
 * Runs one `explorers` command line: a command per tool, `providers` for an empty line, and a
 * first word that names no command, such as a bare address, read as a balance.
 *
 * @param argv - The words after `explorers`.
 * @returns {Promise<void>} Once the command has written its answer and set the exit code.
 */
export async function runExplorersCli(argv: readonly string[]): Promise<void> {
  await runCli(
    {
      name: "explorers",
      version,
      description: "Unified multi-chain block explorer CLI",
      tools: explorersTools(),
      commands: explorersCommands(),
      default: "providers",
      fallback: "balance",
      mcp: serverInfo,
      expected: (error) => error instanceof Error,
    },
    argv,
  );
}
