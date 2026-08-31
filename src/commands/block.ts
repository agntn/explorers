/** Get block info by number */
import { defineCommand } from "citty";
import consola from "consola";
import type { BlockInfo } from "../core/types.js";
import {
  failCommand,
  parseNonNegativeInteger,
  reportCommandError,
  withSelectedProvider,
} from "./shared.js";

function renderBlock(providerName: string, block: Readonly<BlockInfo>): void {
  consola.log(`[${providerName}] Block #${block.number}`);
  consola.log(`  Hash: ${block.hash}`);
  consola.log(`  Timestamp: ${block.timestamp}`);
  consola.log(`  Miner: ${block.miner}`);
  consola.log(`  Gas used/limit: ${block.gasUsed} / ${block.gasLimit}`);
  consola.log(`  Transactions: ${block.txCount}`);
  if (block.baseFee) consola.log(`  Base fee per gas: ${block.baseFee}`);
}

export default defineCommand({
  meta: {
    name: "block",
    description: "Get block info by number",
  },
  args: {
    number: {
      type: "positional",
      description: "Block number",
      required: true,
    },
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
        "blockInfo",
        async (selected) => {
          const blockNumber = parseNonNegativeInteger(
            args.number as string,
            "Invalid block number",
          );
          const getBlockInfo = selected.provider.getBlockInfo?.bind(selected.provider);
          if (!selected.provider.capabilities.blockInfo || !getBlockInfo) {
            failCommand(`Provider "${selected.name}" does not support block info`);
          }
          const block = await getBlockInfo(blockNumber, selected.chain);
          renderBlock(selected.name, block);
        },
      );
    } catch (error) {
      reportCommandError(error);
    }
  },
});
