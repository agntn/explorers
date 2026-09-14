/** Get native token balance for one or more addresses (supports ENS) */
import { defineCommand } from "citty";
import consola from "consola";
import { print } from "./shared.js";

export default defineCommand({
  meta: {
    name: "balance",
    description:
      "Get native token balances with read time for one or more addresses (supports ENS)",
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
      const [{ withProvider }, { normalizeChain }, { resolveAddresses }] = await Promise.all([
        import("../core/resolve.js"),
        import("../core/types.js"),
        import("../core/input.js"),
      ]);
      const chainInput = args.chain as string | undefined;
      const requestedChain = chainInput === undefined ? undefined : normalizeChain(chainInput);
      await withProvider(
        args.provider as string | undefined,
        requestedChain,
        async ({ chain, name, provider }) => {
          const inputs = args._.length > 0 ? args._ : [args.address as string];
          const addresses = await resolveAddresses(inputs, chain);
          const balances = await Promise.all(
            addresses.map((address) => provider.getBalance(address, chain)),
          );
          for (const balance of balances) {
            print(`[${name}] ${balance.chain} balance for ${balance.address}`);
            print(`  ${balance.balanceFormatted} ${balance.symbol}`);
            print(`  Raw: ${balance.balance} base units`);
            if (balance.unconfirmed !== undefined) {
              print(`  Unconfirmed delta: ${balance.unconfirmed} base units`);
            }
            print(`  Fetched: ${balance.fetchedAt}`);
            print(`  Block: ${balance.blockNumber ?? "unknown"}`);
            if (balance.blockHash !== null) {
              print(`  Block hash: ${balance.blockHash}`);
            }
            if (balance.funded !== undefined && balance.spent !== undefined) {
              print(`  Funded: ${balance.funded} base units`);
              print(`  Spent: ${balance.spent} base units`);
            }
          }
        },
        "balances",
      );
    } catch (error) {
      consola.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  },
});
