/** List ERC-20 token holdings (supports ENS) */
import { defineCommand } from "citty";
import consola from "consola";
import { resolveProvider, PROVIDER_DEFAULT_CHAIN } from "../core/resolve.js";
import { create } from "../core/registry.js";
import { normalizeChain } from "../core/types.js";
import { resolveInput } from "../core/input.js";

export default defineCommand({
  meta: {
    name: "tokens",
    description: "List ERC-20 token holdings for an address (supports ENS)",
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
      const chainInput = args.chain as string | undefined;
      const requestedChain = chainInput === undefined ? undefined : normalizeChain(chainInput);
      const providerName = resolveProvider(
        args.provider as string | undefined,
        requestedChain,
        "tokenBalances",
      );
      const provider = await create(providerName);
      const chain = requestedChain ?? normalizeChain(PROVIDER_DEFAULT_CHAIN[providerName]);

      const caps = provider.capabilities;
      if (!caps.tokenBalances || !provider.getTokenBalances) {
        consola.error(`Provider "${providerName}" does not support token balances`);
        process.exit(1);
      }
      const { address } = await resolveInput(args.address as string, chain);
      const tokens = await provider.getTokenBalances(address, chain, { nonZeroOnly: true });
      consola.log(`[${providerName}] ${tokens.length} tokens for ${address} on ${chain}`);
      consola.log("");
      for (const t of tokens) {
        const usd = t.valueUsd ? ` ($${t.valueUsd.toFixed(2)})` : "";
        consola.log(`  ${t.symbol}: ${t.balanceFormatted}${usd}  [${t.contract.slice(0, 10)}…]`);
      }
    } catch (error) {
      consola.error(`Error: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  },
});
