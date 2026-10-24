/** OMP extension: the explorer tools, one definition each, shared with MCP, Pi and the CLI. */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { registerOmpTools, type OmpRenderers } from "@agntn/tools/omp";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import type * as ExplorersTools from "../../src/tools.ts";

const sourceModulePath = fileURLToPath(new URL("../../src/tools.ts", import.meta.url));

/**
 * Both specifiers stay literal: compiled OMP resolves bare imports only where it sees them.
 *
 * @returns {Promise<typeof ExplorersTools>} The definitions and their renderers.
 */
function loadTools(): Promise<typeof ExplorersTools> {
  return (
    existsSync(sourceModulePath) ? import("../../src/tools.ts") : import("../../dist/tools.mjs")
  ) as Promise<typeof ExplorersTools>;
}

/**
 * Registers the explorer tools under their own label. The executors and the providers load with
 * the first call.
 *
 * @param pi - OMP extension API supplied by the host.
 */
export default async function explorersOmpExtension(pi: ExtensionAPI): Promise<void> {
  pi.setLabel("Explorers");
  const { describeCall, explorersTools, terminalLines } = await loadTools();
  const tools = explorersTools();
  const { Text } = pi.pi;
  const renderers = Object.fromEntries(
    tools.map((tool): [string, OmpRenderers] => [
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
  registerOmpTools(pi, tools, { Text, renderers });
}
