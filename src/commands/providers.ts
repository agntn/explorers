/**
 * List registered providers and their capabilities
 */
import { defineCommand } from "citty";
import consola from "consola";
import { create, providers as listProviders } from "../core/registry.js";

export default defineCommand({
  meta: {
    name: "providers",
    description: "List registered block explorer providers and capabilities",
  },
  async run() {
    const names = listProviders();
    consola.info(`Registered providers (${names.length}):`);
    consola.log("");

    for (const name of names) {
      try {
        const provider = create(name);
        const caps = provider.capabilities;
        const capList = Object.entries(caps)
          .filter(([, v]) => v)
          .map(([k]) => k)
          .join(", ");
        consola.log(`  ${name}: ${capList}`);
      } catch {
        consola.log(`  ${name}: (requires API key — set env var to activate)`);
      }
    }

    consola.log("");
    consola.info("Use --provider <name> to select a specific provider");
  },
});
