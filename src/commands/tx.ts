/** Transaction operations — history or detail (supports ENS) */
import { defineCommand } from "citty";
import consola from "consola";
import { resolveProvider, PROVIDER_DEFAULT_CHAIN } from "../core/resolve.js";
import { create } from "../core/registry.js";
import { normalizeChain } from "../core/types.js";
import { classifyInput, resolveInput } from "../core/input.js";

export default defineCommand({
  meta: {
    name: "tx",
    description: "Get transaction history or detail (supports ENS)",
  },
  args: {
    target: {
      type: "positional",
      description: "Address, ENS name, or tx hash",
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
      description: "Max results (for history)",
      default: "10",
    },
    mode: {
      type: "string",
      alias: "m",
      description: "Operation mode (history or detail)",
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
      const providerName = resolveProvider(args.provider as string | undefined, requestedChain);
      const provider = create(providerName);
      const chain = requestedChain ?? normalizeChain(PROVIDER_DEFAULT_CHAIN[providerName]);
      const rawTarget = (args.target as string).trim();
      const requestedMode = args.mode as string | undefined;
      if (
        requestedMode !== undefined &&
        requestedMode !== "history" &&
        requestedMode !== "detail"
      ) {
        consola.error('Invalid --mode value (expected "history" or "detail")');
        process.exit(1);
      }
      const mode =
        requestedMode ?? (classifyInput(rawTarget, chain) === "txhash" ? "detail" : "history");

      if (mode === "detail") {
        if (!provider.capabilities.txDetail || !provider.getTxDetail) {
          consola.error(`Provider "${providerName}" does not support transaction details`);
          process.exit(1);
        }
        const tx = await provider.getTxDetail(rawTarget, chain);
        consola.log(`[${providerName}] Tx ${tx.hash}`);
        consola.log(`  Block: ${tx.blockNumber}`);
        consola.log(`  From: ${tx.from}`);
        consola.log(`  To: ${tx.to ?? "contract creation"}`);
        consola.log(`  Value: ${tx.valueFormatted}`);
        consola.log(`  Status: ${tx.status}`);
        if (tx.fee) consola.log(`  Fee: ${tx.fee} base units`);
        if (tx.functionName) consola.log(`  Method: ${tx.functionName}`);
        if (tx.tokenTransfers.length > 0) {
          consola.log(`  Token transfers: ${tx.tokenTransfers.length}`);
        }
        for (const payload of tx.opReturn ?? []) {
          consola.log(`  OP_RETURN: ${payload.text ?? payload.hex}`);
        }
      } else {
        const { address } = await resolveInput(rawTarget, chain);
        const limitText = (args.limit as string).trim();
        const limit = Number(limitText);
        if (!/^\d+$/.test(limitText) || !Number.isSafeInteger(limit) || limit < 1) {
          consola.error("Invalid --limit value");
          process.exit(1);
        }
        const txs = await provider.getTxHistory(address, chain, { limit });
        consola.log(`[${providerName}] ${txs.length} transactions for ${address} on ${chain}`);
        consola.log("");
        for (const tx of txs) {
          const val = tx.valueFormatted !== "0" ? ` ${tx.valueFormatted}` : "";
          consola.log(
            `  ${tx.hash.slice(0, 18)}…  ${tx.from.slice(0, 10)}… → ${(tx.to ?? "?").slice(0, 10)}…${val}  [${tx.status}]`,
          );
        }
      }
    } catch (error) {
      consola.error(`Error: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  },
});
