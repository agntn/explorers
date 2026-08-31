/** List fungible token holdings (supports ENS) */
import { defineCommand } from "citty";
import consola from "consola";
import { resolveInput } from "../core/input.js";
import { withSelectedProvider } from "./shared.js";

export default defineCommand({
  meta: {
    name: "tokens",
    description: "List fungible token holdings for an address (supports ENS)",
  },
  args: {
    address: {
      type: "positional",
      description: "Blockchain address or ENS name",
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
        "tokenBalances",
        async ({ chain, name, provider }) => {
          const caps = provider.capabilities;
          if (!caps.tokenBalances || !provider.getTokenBalances) {
            consola.error(`Provider "${name}" does not support token balances`);
            process.exit(1);
          }
          const { address } = await resolveInput(args.address as string, chain);
          const tokens = await provider.getTokenBalances(address, chain, { nonZeroOnly: true });
          consola.log(`[${name}] ${tokens.length} tokens for ${address} on ${chain}`);
          consola.log("");
          for (const token of tokens) {
            const usd = token.valueUsd ? ` ($${token.valueUsd.toFixed(2)})` : "";
            consola.log(
              `  ${token.symbol}: ${token.balanceFormatted}${usd}  [${token.contract.slice(0, 10)}…]`,
            );
          }
        },
      );
    } catch (error) {
      consola.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  },
});
