/** Get block info by number */
import { defineCommand } from "citty";
import consola from "consola";
import { resolveProvider, PROVIDER_DEFAULT_CHAIN } from "../core/resolve.js";
import { create } from "../core/registry.js";
import { normalizeChain } from "../core/types.js";

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
      const chainInput = args.chain as string | undefined;
      const requestedChain = chainInput === undefined ? undefined : normalizeChain(chainInput);
      const providerName = resolveProvider(
        args.provider as string | undefined,
        requestedChain,
        "blockInfo",
      );
      const provider = await create(providerName);
      const chain = requestedChain ?? normalizeChain(PROVIDER_DEFAULT_CHAIN[providerName]);
      const blockText = (args.number as string).trim();
      const blockNum = Number(blockText);

      if (!/^\d+$/.test(blockText) || !Number.isSafeInteger(blockNum)) {
        consola.error("Invalid block number");
        process.exit(1);
      }

      const caps = provider.capabilities;
      if (!caps.blockInfo || !provider.getBlockInfo) {
        consola.error(`Provider "${providerName}" does not support block info`);
        process.exit(1);
      }
      const block = await provider.getBlockInfo(blockNum, chain);
      consola.log(`[${providerName}] Block #${block.number}`);
      consola.log(`  Hash: ${block.hash}`);
      consola.log(`  Timestamp: ${block.timestamp}`);
      consola.log(`  Miner: ${block.miner}`);
      consola.log(`  Gas used/limit: ${block.gasUsed} / ${block.gasLimit}`);
      consola.log(`  Transactions: ${block.txCount}`);
      if (block.baseFee) consola.log(`  Base fee per gas: ${block.baseFee}`);
    } catch (error) {
      consola.error(`Error: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  },
});
