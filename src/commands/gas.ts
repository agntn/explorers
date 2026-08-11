/** Get current gas prices */
import { defineCommand } from "citty";
import consola from "consola";
import { resolveProvider, PROVIDER_DEFAULT_CHAIN } from "../core/resolve.js";
import { create } from "../core/registry.js";
import { normalizeChain } from "../core/types.js";

export default defineCommand({
  meta: {
    name: "gas",
    description: "Get current gas prices",
  },
  args: {
    chain: {
      type: "string",
      alias: "c",
      description: "Chain",
    },
    provider: {
      type: "string",
      alias: "p",
      description: "Provider",
    },
  },
  async run({ args }) {
    try {
      const providerName = resolveProvider(args.provider as string | undefined);
      const provider = create(providerName);
      const requestedChain = args.chain as string | undefined;
      const chain = normalizeChain(requestedChain ?? PROVIDER_DEFAULT_CHAIN[providerName]);

      const caps = provider.capabilities;
      if (!caps.gasData || !provider.getGasData) {
        consola.error(`Provider "${providerName}" does not support gas data`);
        process.exit(1);
      }
      const gas = await provider.getGasData(chain);
      consola.log(`[${providerName}] Gas prices on ${gas.chain}`);
      if (gas.safeGasPrice) consola.log(`  Safe/Low: ${gas.safeGasPrice} ${gas.unit}`);
      if (gas.proposedGasPrice) consola.log(`  Average:  ${gas.proposedGasPrice} ${gas.unit}`);
      if (gas.fastGasPrice) consola.log(`  Fast:     ${gas.fastGasPrice} ${gas.unit}`);
      if (gas.baseFee) consola.log(`  Base fee: ${gas.baseFee} ${gas.unit}`);
      if (gas.priorityFee) consola.log(`  Priority: ${gas.priorityFee} ${gas.unit}`);
    } catch (error) {
      consola.error(`Error: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  },
});
