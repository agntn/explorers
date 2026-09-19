/** List fungible token holdings (supports ENS) */
import { defineCommand } from "citty";
import consola from "consola";
import { parsePositiveInteger, print, withSelectedProvider } from "./shared.js";

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
    limit: {
      type: "string",
      alias: "n",
      description: "Max holdings listed",
      default: "50",
    },
    provider: {
      type: "string",
      alias: "p",
      description: "Provider",
    },
  },
  async run({ args }) {
    try {
      const { resolveInput } = await import("../core/input.js");
      const limit = parsePositiveInteger(args.limit as string, "Invalid --limit value");
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
          const holdings = await provider.getTokenBalances(address, chain, { nonZeroOnly: true });
          const tokens = holdings.slice(0, limit);
          const listed = tokens.length < holdings.length ? `, ${tokens.length} listed` : "";
          print(`[${name}] ${holdings.length} tokens for ${address} on ${chain}${listed}`);
          print("");
          for (const token of tokens) {
            const usd = token.valueUsd ? ` ($${token.valueUsd.toFixed(2)})` : "";
            print(
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
