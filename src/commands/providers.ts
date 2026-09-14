/** List registered providers and their capabilities */
import { defineCommand } from "citty";
import consola from "consola";

export default defineCommand({
  meta: {
    name: "providers",
    description: "List registered block explorer providers and capabilities",
  },
  async run() {
    const { listProviders } = await import("../core/registry.js");
    const listed = listProviders();
    consola.info(`Registered providers (${listed.length}):`);
    consola.log("");

    for (const { name, chains, capabilities } of listed) {
      const capList =
        capabilities === undefined
          ? "(capabilities not declared)"
          : Object.entries(capabilities)
              .filter(([, supported]) => supported)
              .map(([capability]) => capability)
              .join(", ") || "(no supported explorer operations)";
      consola.log(`  ${name}: ${capList}; chains: ${chains.join(", ") || "none"}`);
    }

    consola.log("");
    consola.info("Use --provider <name> to select a specific provider");
  },
});
