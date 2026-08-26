/** List fungible-token transfers (supports ENS) */
import { defineCommand } from "citty";
import consola from "consola";
import { resolveProvider, PROVIDER_DEFAULT_CHAIN } from "../core/resolve.js";
import { create } from "../core/registry.js";
import { normalizeChain } from "../core/types.js";
import { resolveInput } from "../core/input.js";

export default defineCommand({
  meta: {
    name: "transfers",
    description: "List token transfers involving an address (supports ENS)",
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
    token: {
      type: "string",
      alias: "t",
      description: "Only transfers of this token contract",
    },
    limit: {
      type: "string",
      alias: "n",
      description: "Max results",
      default: "10",
    },
  },
  async run({ args }) {
    try {
      const chainInput = args.chain as string | undefined;
      const requestedChain = chainInput === undefined ? undefined : normalizeChain(chainInput);
      const providerName = resolveProvider(
        args.provider as string | undefined,
        requestedChain,
        "tokenTransfers",
      );
      const provider = await create(providerName);
      const chain = requestedChain ?? normalizeChain(PROVIDER_DEFAULT_CHAIN[providerName]);

      const caps = provider.capabilities;
      if (!caps.tokenTransfers || !provider.getTokenTransfers) {
        consola.error(`Provider "${providerName}" does not support token transfers`);
        process.exit(1);
      }
      const limitText = (args.limit as string).trim();
      const limit = Number(limitText);
      if (!/^\d+$/.test(limitText) || !Number.isSafeInteger(limit) || limit < 1) {
        consola.error("Invalid --limit value");
        process.exit(1);
      }
      const { address } = await resolveInput(args.address as string, chain);
      const transfers = await provider.getTokenTransfers(address, chain, {
        limit,
        token: args.token as string | undefined,
      });
      consola.log(
        `[${providerName}] ${transfers.length} token transfers for ${address} on ${chain}`,
      );
      consola.log("");
      for (const t of transfers) {
        consola.log(
          `  ${t.txHash.slice(0, 18)}…  ${t.from.slice(0, 10)}… → ${t.to.slice(0, 10)}…  ${t.valueFormatted} ${t.symbol}`,
        );
      }
    } catch (error) {
      consola.error(`Error: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  },
});
