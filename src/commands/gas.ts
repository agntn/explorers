/** Get current gas prices */
import { defineCommand } from "citty";
import type { GasData } from "../core/types.js";
import { failCommand, print, reportCommandError, withSelectedProvider } from "./shared.js";

function renderGas(providerName: string, gas: Readonly<GasData>): void {
  print(`[${providerName}] Gas prices on ${gas.chain}`);
  if (gas.safeGasPrice) print(`  Safe/Low: ${gas.safeGasPrice} ${gas.unit}`);
  if (gas.proposedGasPrice) print(`  Average:  ${gas.proposedGasPrice} ${gas.unit}`);
  if (gas.fastGasPrice) print(`  Fast:     ${gas.fastGasPrice} ${gas.unit}`);
  if (gas.baseFee) print(`  Base fee: ${gas.baseFee} ${gas.unit}`);
  if (gas.priorityFee) print(`  Priority: ${gas.priorityFee} ${gas.unit}`);
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
