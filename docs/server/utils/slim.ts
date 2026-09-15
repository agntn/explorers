import type { ContractInfo, Transaction } from "@agntn/explorers";
import type { WireContract, WireTransaction } from "#shared/wire";

export function slimTransaction(transaction: Transaction): WireTransaction {
  const { raw: _raw, tokenTransfers, ...rest } = transaction;
  return {
    ...rest,
    tokenTransfers: tokenTransfers
      .slice(0, 20)
      .map(({ txHash: _hash, ...transfer }) => transfer),
  };
}

function abiEntries(abi: string | undefined): number | null {
  if (!abi) return null;
  try {
    const parsed: unknown = JSON.parse(abi);
    return Array.isArray(parsed) ? parsed.length : null;
  } catch {
    return null;
  }
}

/** The ABI and the source are counted rather than shipped; a verified contract's source can run to hundreds of kilobytes. */
export function slimContract(contract: ContractInfo): WireContract {
  const { abi, sourceCode, ...rest } = contract;
  return {
    ...rest,
    abiEntries: abiEntries(abi),
    sourceLength: sourceCode ? sourceCode.length : null,
  };
}
