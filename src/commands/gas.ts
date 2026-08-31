/** Get current gas prices */
import { defineCommand } from "citty";
import consola from "consola";
import type { GasData } from "../core/types.js";
import { failCommand, reportCommandError, withSelectedProvider } from "./shared.js";

function renderGas(providerName: string, gas: Readonly<GasData>): void {
  consola.log(`[${providerName}] Gas prices on ${gas.chain}`);
  if (gas.safeGasPrice) consola.log(`  Safe/Low: ${gas.safeGasPrice} ${gas.unit}`);
  if (gas.proposedGasPrice) consola.log(`  Average:  ${gas.proposedGasPrice} ${gas.unit}`);
  if (gas.fastGasPrice) consola.log(`  Fast:     ${gas.fastGasPrice} ${gas.unit}`);
  if (gas.baseFee) consola.log(`  Base fee: ${gas.baseFee} ${gas.unit}`);
  if (gas.priorityFee) consola.log(`  Priority: ${gas.priorityFee} ${gas.unit}`);
}

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
      await withSelectedProvider(
        args.chain as string | undefined,
        args.provider as string | undefined,
        "gasData",
        async (selected) => {
          const getGasData = selected.provider.getGasData?.bind(selected.provider);
          if (!selected.provider.capabilities.gasData || !getGasData) {
            failCommand(`Provider "${selected.name}" does not support gas data`);
          }
          const gas = await getGasData(selected.chain);
          renderGas(selected.name, gas);
        },
      );
    } catch (error) {
      reportCommandError(error);
    }
  },
});
