/** Transaction operations — history or detail (supports ENS) */
import { defineCommand } from "citty";
import type { ChainKey, Transaction } from "../core/types.js";
import {
  failCommand,
  parsePositiveInteger,
  print,
  reportCommandError,
  withSelectedProvider,
} from "./shared.js";
import type { SelectedProvider } from "./shared.js";

type TransactionMode = "detail" | "history";

async function transactionMode(
  requested: string | undefined,
  target: string,
  chain: ChainKey,
): Promise<TransactionMode> {
  if (requested !== undefined && requested !== "history" && requested !== "detail") {
    failCommand('Invalid --mode value (expected "history" or "detail")');
  }
  const { classifyInput } = await import("../core/input.js");
  return requested ?? (classifyInput(target, chain) === "txhash" ? "detail" : "history");
}

/* oxlint-disable-next-line typescript/prefer-readonly-parameter-types */
function renderOpReturns(transaction: Transaction): void {
  for (const payload of transaction.opReturn ?? []) {
    const [first = "", ...rest] = (payload.text ?? payload.hex).split("\n");
    print(`  OP_RETURN: ${first}`);
    for (const line of rest) print(`    ${line}`);
  }
}

/* oxlint-disable-next-line typescript/prefer-readonly-parameter-types */
function renderTransaction(providerName: string, transaction: Transaction): void {
  print(`[${providerName}] Tx ${transaction.hash}`);
  print(`  Block: ${transaction.blockNumber}`);
  print(`  From: ${transaction.from}`);
  print(`  To: ${transaction.to ?? "contract creation"}`);
  print(`  Value: ${transaction.valueFormatted}`);
  print(`  Status: ${transaction.status}`);
  if (transaction.fee) print(`  Fee: ${transaction.fee} base units`);
  if (transaction.functionName) print(`  Method: ${transaction.functionName}`);
  if (transaction.tokenTransfers.length > 0) {
    print(`  Token transfers: ${transaction.tokenTransfers.length}`);
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
  const { resolveInput } = await import("../core/input.js");
  const { address } = await resolveInput(target, selected.chain);
  const limit = parsePositiveInteger(limitInput, "Invalid --limit value");
  const transactions = await selected.provider.getTxHistory(address, selected.chain, { limit });
  print(
    `[${selected.name}] ${transactions.length} transactions for ${address} on ${selected.chain}`,
  );
  print("");
  for (const transaction of transactions) {
    const value = transaction.valueFormatted !== "0" ? ` ${transaction.valueFormatted}` : "";
    print(
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
      const [{ PROVIDER_DEFAULT_CHAIN, resolveProvider }, { normalizeChain }] = await Promise.all([
        import("../core/resolve.js"),
        import("../core/types.js"),
      ]);
      const chainInput = args.chain as string | undefined;
      const providerInput = args.provider as string | undefined;
      const requestedChain = chainInput === undefined ? undefined : normalizeChain(chainInput);
      const initialName = resolveProvider(providerInput, requestedChain);
      const initialChain = requestedChain ?? normalizeChain(PROVIDER_DEFAULT_CHAIN[initialName]);
      const target = (args.target as string).trim();
      const mode = await transactionMode(args.mode as string | undefined, target, initialChain);
      await withSelectedProvider(
        initialChain,
        providerInput,
        mode === "detail" ? "txDetail" : "txHistory",
        async (selected) => {
          if (mode === "detail") await runDetail(selected, target);
          else await runHistory(selected, target, args.limit as string);
        },
      );
    } catch (error) {
      reportCommandError(error);
    }
  },
});
