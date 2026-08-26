/** Get native token balance for one or more addresses (supports ENS) */
import { defineCommand } from "citty";
import consola from "consola";
import { resolveProvider, PROVIDER_DEFAULT_CHAIN } from "../core/resolve.js";
import { create } from "../core/registry.js";
import { normalizeChain } from "../core/types.js";
import { resolveAddresses } from "../core/input.js";

export default defineCommand({
  meta: {
    name: "balance",
    description: "Get native token balance for one or more addresses (supports ENS)",
  },
  args: {
    address: {
      type: "positional",
      description: "Blockchain address or ENS name; pass several to batch",
      required: true,
    },
    chain: {
      type: "string",
      alias: "c",
      description: "Chain (eth, base, arbitrum, bitcoin, ...)",
    },
    provider: {
      type: "string",
      alias: "p",
      description: "Provider (etherscan, blockscout, blockchair)",
    },
  },
  async run({ args }) {
    try {
      const chainInput = args.chain as string | undefined;
      const requestedChain = chainInput === undefined ? undefined : normalizeChain(chainInput);
      const providerName = resolveProvider(args.provider as string | undefined, requestedChain);
      const provider = await create(providerName);
      const chain = requestedChain ?? normalizeChain(PROVIDER_DEFAULT_CHAIN[providerName]);
      const inputs = args._.length > 0 ? args._ : [args.address as string];
      const addresses = await resolveAddresses(inputs, chain);
      const balances = await Promise.all(
        addresses.map((address) => provider.getBalance(address, chain)),
      );
      for (const balance of balances) {
        consola.log(`[${providerName}] ${balance.chain} balance for ${balance.address}`);
        consola.log(`  ${balance.balanceFormatted} ${balance.symbol}`);
        consola.log(`  Raw: ${balance.balance} base units`);
      }
    } catch (error) {
      consola.error(`Error: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  },
});
