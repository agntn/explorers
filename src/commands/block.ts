/** Get block info by number */
import { defineCommand } from "citty";
import type { BlockInfo } from "../core/types.ts";
import {
  failCommand,
  parseNonNegativeInteger,
  print,
  reportCommandError,
  withSelectedProvider,
} from "./shared.ts";

function renderBlock(providerName: string, block: Readonly<BlockInfo>): void {
  print(`[${providerName}] Block #${block.number}`);
  print(`  Hash: ${block.hash}`);
  print(`  Timestamp: ${block.timestamp}`);
  print(`  Miner: ${block.miner}`);
  print(`  Gas used/limit: ${block.gasUsed} / ${block.gasLimit}`);
  print(`  Transactions: ${block.txCount}`);
  if (block.baseFee) print(`  Base fee per gas: ${block.baseFee}`);
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
