/** Transaction operations — history or detail (supports ENS) */
import { defineCommand } from "citty";
import consola from "consola";
import { classifyInput, resolveInput } from "../core/input.js";
import { PROVIDER_DEFAULT_CHAIN, resolveProvider } from "../core/resolve.js";
import { normalizeChain } from "../core/types.js";
import type { ChainKey, Transaction } from "../core/types.js";
import { failCommand, parsePositiveInteger, reportCommandError, selectProvider } from "./shared.js";
import type { SelectedProvider } from "./shared.js";

type TransactionMode = "detail" | "history";

function transactionMode(
  requested: string | undefined,
  target: string,
  chain: ChainKey,
): TransactionMode {
  if (requested !== undefined && requested !== "history" && requested !== "detail") {
    failCommand('Invalid --mode value (expected "history" or "detail")');
  }
  return requested ?? (classifyInput(target, chain) === "txhash" ? "detail" : "history");
}

/* oxlint-disable-next-line typescript/prefer-readonly-parameter-types */
function renderOpReturns(transaction: Transaction): void {
  for (const payload of transaction.opReturn ?? []) {
    const [first = "", ...rest] = (payload.text ?? payload.hex).split("\n");
    consola.log(`  OP_RETURN: ${first}`);
    for (const line of rest) consola.log(`    ${line}`);
  }
}

/* oxlint-disable-next-line typescript/prefer-readonly-parameter-types */
function renderTransaction(providerName: string, transaction: Transaction): void {
  consola.log(`[${providerName}] Tx ${transaction.hash}`);
  consola.log(`  Block: ${transaction.blockNumber}`);
  consola.log(`  From: ${transaction.from}`);
  consola.log(`  To: ${transaction.to ?? "contract creation"}`);
  consola.log(`  Value: ${transaction.valueFormatted}`);
  consola.log(`  Status: ${transaction.status}`);
  if (transaction.fee) consola.log(`  Fee: ${transaction.fee} base units`);
  if (transaction.functionName) consola.log(`  Method: ${transaction.functionName}`);
  if (transaction.tokenTransfers.length > 0) {
    consola.log(`  Token transfers: ${transaction.tokenTransfers.length}`);
  }
  renderOpReturns(transaction);
}

/* oxlint-disable-next-line typescript/prefer-readonly-parameter-types */
async function runDetail(selected: SelectedProvider, target: string): Promise<void> {
  const getTxDetail = selected.provider.getTxDetail?.bind(selected.provider);
  if (!selected.provider.capabilities.txDetail || !getTxDetail) {
    failCommand(`Provider "${selected.name}" does not support transaction details`);
  }
  const transaction = await getTxDetail(target, selected.chain);
  renderTransaction(selected.name, transaction);
}

async function runHistory(
  /* oxlint-disable-next-line typescript/prefer-readonly-parameter-types */
  selected: SelectedProvider,
  target: string,
  limitInput: string,
): Promise<void> {
  const { address } = await resolveInput(target, selected.chain);
  const limit = parsePositiveInteger(limitInput, "Invalid --limit value");
  const transactions = await selected.provider.getTxHistory(address, selected.chain, { limit });
  consola.log(
    `[${selected.name}] ${transactions.length} transactions for ${address} on ${selected.chain}`,
  );
  consola.log("");
  for (const transaction of transactions) {
    const value = transaction.valueFormatted !== "0" ? ` ${transaction.valueFormatted}` : "";
    consola.log(
      `  ${transaction.hash.slice(0, 18)}…  ${transaction.from.slice(0, 10)}… → ${(transaction.to ?? "?").slice(0, 10)}…${value}  [${transaction.status}]`,
    );
  }
}

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
      const providerInput = args.provider as string | undefined;
      const requestedChain = chainInput === undefined ? undefined : normalizeChain(chainInput);
      const initialName = resolveProvider(providerInput, requestedChain);
      const initialChain = requestedChain ?? normalizeChain(PROVIDER_DEFAULT_CHAIN[initialName]);
      const target = (args.target as string).trim();
      const mode = transactionMode(args.mode as string | undefined, target, initialChain);
      const selected = await selectProvider(
        initialChain,
        providerInput,
        mode === "detail" ? "txDetail" : "txHistory",
      );
      if (mode === "detail") await runDetail(selected, target);
      else await runHistory(selected, target, args.limit as string);
    } catch (error) {
      reportCommandError(error);
    }
  },
});
