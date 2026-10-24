/** Pi extension: the explorer tools, one definition each, shared with MCP, OMP and the CLI. */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { registerPiTools, type PiRenderers } from "@agntn/tools/pi";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type * as ExplorersTools from "../../src/tools.ts";

const sourceModuleUrl = new URL("../../src/tools.ts", import.meta.url);
const distributionModuleUrl = new URL("../../dist/tools.mjs", import.meta.url);

/**
 * Return live source in a checkout, otherwise the built module shipped in the package.
 *
 * @returns {string} The URL of the tool definitions to import.
 */
export function resolveExplorersModuleUrl(): string {
  return existsSync(fileURLToPath(sourceModuleUrl))
    ? sourceModuleUrl.href
    : distributionModuleUrl.href;
}

/**
 * Registers the explorer tools. The executors and the providers load with the first call.
 *
 * @param pi - Pi extension API.
 */
export default async function explorersExtension(pi: ExtensionAPI): Promise<void> {
  const { describeCall, explorersTools, terminalLines } = (await import(
    resolveExplorersModuleUrl()
  )) as typeof ExplorersTools;
  const tools = explorersTools();
  const renderers = Object.fromEntries(
    tools.map((tool): [string, PiRenderers] => [
      tool.name,
      {
        describeCall,
        renderResult(result, { expanded, isPartial }, theme) {
          if (isPartial) return new Text(theme.fg("warning", "Asking the explorer…"), 0, 0);
          return new Text(terminalLines(tool.name, { result, expanded }).join("\n"), 0, 0);
        },
      },
    ]),
  );
  registerPiTools(pi, tools, { Text, renderers });
}
