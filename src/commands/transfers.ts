/** List fungible-token transfers (supports ENS) */
import { defineCommand } from "citty";
import consola from "consola";
import { resolveInput } from "../core/input.js";
import type { TokenTransfer } from "../core/types.js";
import {
  failCommand,
  parsePositiveInteger,
  reportCommandError,
  withSelectedProvider,
} from "./shared.js";

function renderTransfers(
  providerName: string,
  address: string,
  chain: string,
  /* oxlint-disable-next-line typescript/prefer-readonly-parameter-types */
  transfers: readonly TokenTransfer[],
): void {
  consola.log(`[${providerName}] ${transfers.length} token transfers for ${address} on ${chain}`);
  consola.log("");
  for (const transfer of transfers) {
    consola.log(
      `  ${transfer.txHash.slice(0, 18)}…  ${transfer.from.slice(0, 10)}… → ${transfer.to.slice(0, 10)}…  ${transfer.valueFormatted} ${transfer.symbol}`,
    );
  }
}

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
      await withSelectedProvider(
        args.chain as string | undefined,
        args.provider as string | undefined,
        "tokenTransfers",
        async (selected) => {
          const getTokenTransfers = selected.provider.getTokenTransfers?.bind(selected.provider);
          if (!selected.provider.capabilities.tokenTransfers || !getTokenTransfers) {
            failCommand(`Provider "${selected.name}" does not support token transfers`);
          }
          const limit = parsePositiveInteger(args.limit as string, "Invalid --limit value");
          const { address } = await resolveInput(args.address as string, selected.chain);
          const transfers = await getTokenTransfers(address, selected.chain, {
            limit,
            token: args.token as string | undefined,
          });
          renderTransfers(selected.name, address, selected.chain, transfers);
        },
      );
    } catch (error) {
      reportCommandError(error);
    }
  },
});
