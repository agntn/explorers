/**
 * Solana provider — Solana public RPC
 *
 * Public JSON-RPC, no key needed. Native Solana data:
 * SOL balance, tx history, tx detail, block info, fee estimates.
 *
 * https://solana.com/docs/rpc
 */

import type {
  ProviderCapabilities,
  ProviderConfig,
  Chain,
  Balance,
  Transaction,
  TxHistoryOptions,
  GasData,
  BlockInfo,
  TxStatus,
} from "../core/types.js";
import { Provider } from "../core/provider.js";
import { normalizeError, UnsupportedChainError } from "../core/errors.js";
import { register } from "../core/registry.js";
import { clampMaxResults, formatWei } from "../core/types.js";

const DEFAULT_RPC = "https://api.mainnet-beta.solana.com";

interface RpcResponse<T> {
  jsonrpc: string;
  id: number;
  result?: T;
  error?: { code: number; message: string };
}

interface SignatureInfo {
  signature: string;
  slot: number;
  blockTime: number | null;
  err: unknown | null;
  confirmationStatus: string | null;
  memo: string | null;
}

interface TransactionDetail {
  slot: number;
  transaction: {
    message: {
      accountKeys: Array<{ pubkey: string; signer: boolean; writable: boolean }>;
      instructions: Array<{ programId: string; data: string }>;
      recentBlockhash: string;
    };
    signatures: string[];
  };
  meta: {
    err: unknown | null;
    fee: number | string;
    preBalances: Array<number | string>;
    postBalances: Array<number | string>;
    innerInstructions: unknown[];
    logMessages: string[];
  } | null;
  blockTime: number | null;
}

interface BlockInfo_rpc {
  blockhash: string;
  previousBlockhash: string;
  parentSlot: number;
  blockTime: number | null;
  transactions: unknown[];
  rewards: unknown[];
}

class Solana extends Provider {
  private rpcUrl: string;

  constructor(config: ProviderConfig) {
    super(config);
    this.rpcUrl = config.baseUrl ?? DEFAULT_RPC;
  }

  static readonly providerName = "solana";
  readonly name = Solana.providerName;

  get capabilities(): ProviderCapabilities {
    return {
      balances: true,
      txHistory: true,
      txDetail: true,
      contractInfo: false,
      tokenBalances: false,
      gasData: true,
      blockInfo: true,
    };
  }

  private async rpcCall<T>(method: string, params: unknown[]): Promise<T> {
    const response = await this.postJSON<RpcResponse<T>>(this.rpcUrl, {
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    });
    if (response.error) {
      throw normalizeError(new Error(`Solana RPC error: ${response.error.message}`), "solana");
    }
    if (!("result" in response)) {
      throw normalizeError(new Error("Solana RPC response did not include a result"), "solana");
    }
    return response.result as T;
  }

  async getBalance(address: string, chain?: Chain): Promise<Balance> {
    const c = chain ?? "solana";
    if (c !== "solana") throw new UnsupportedChainError(c, "solana");

    const result = await this.rpcCall<{ context: { slot: number }; value: number | string }>(
      "getBalance",
      [address],
    );

    return {
      address,
      chain: "solana",
      balance: result.value.toString(),
      balanceFormatted: formatWei(String(result.value), 9),
      symbol: "SOL",
    };
  }

  async getTxHistory(
    address: string,
    chain?: Chain,
    options?: TxHistoryOptions,
  ): Promise<Transaction[]> {
    const c = chain ?? "solana";
    if (c !== "solana") throw new UnsupportedChainError(c, "solana");

    const limit = clampMaxResults(options?.limit);

    const sigs = await this.rpcCall<SignatureInfo[]>("getSignaturesForAddress", [
      address,
      { limit },
    ]);

    if (!sigs?.length) return [];

    return sigs.map((sig) => ({
      hash: sig.signature,
      blockNumber: sig.slot,
      timestamp: sig.blockTime ? new Date(sig.blockTime * 1000).toISOString() : undefined,
      from: "",
      to: null,
      value: "0",
      valueFormatted: "0",
      status: (sig.err ? "failed" : "success") as TxStatus,
      isContractInteraction: false,
      tokenTransfers: [],
      raw: sig as unknown as Record<string, unknown>,
    }));
  }

  override async getTxDetail(hash: string, chain?: Chain): Promise<Transaction> {
    const c = chain ?? "solana";
    if (c !== "solana") throw new UnsupportedChainError(c, "solana");

    const result = await this.rpcCall<TransactionDetail | null>("getTransaction", [
      hash,
      { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 },
    ]);

    if (!result) {
      throw normalizeError(new Error(`Transaction not found: ${hash}`), "solana");
    }

    const accountKeys = result.transaction.message.accountKeys.map((k) => k.pubkey);
    const fee = BigInt(result.meta?.fee ?? 0);
    const preBalances = result.meta?.preBalances ?? [];
    const postBalances = result.meta?.postBalances ?? [];

    // Calculate net SOL change for first signer (usually the sender).
    const firstSigner = result.transaction.message.accountKeys.find((key) => key.signer);
    const signerIndex = firstSigner ? accountKeys.indexOf(firstSigner.pubkey) : 0;
    const netChange =
      BigInt(postBalances[signerIndex] ?? 0) - BigInt(preBalances[signerIndex] ?? 0);
    const transferChange = netChange + fee;
    const absoluteChange = transferChange < 0n ? -transferChange : transferChange;

    return {
      hash: result.transaction.signatures[0] ?? hash,
      blockNumber: result.slot,
      timestamp: result.blockTime ? new Date(result.blockTime * 1000).toISOString() : undefined,
      from: accountKeys[0] ?? "",
      to: accountKeys[1] ?? null,
      value: absoluteChange.toString(),
      valueFormatted: formatWei(absoluteChange, 9),
      fee: fee.toString(),
      status: (result.meta?.err ? "failed" : "success") as TxStatus,
      isContractInteraction: result.transaction.message.instructions.some(
        (ix) =>
          ix.programId !== "11111111111111111111111111111111" &&
          ix.programId !== "ComputeBudget111111111111111111111111111111",
      ),
      tokenTransfers: [],
    };
  }

  override async getGasData(chain?: Chain): Promise<GasData> {
    const c = chain ?? "solana";
    if (c !== "solana") throw new UnsupportedChainError(c, "solana");

    // Get recent prioritization fees
    const fees = await this.rpcCall<Array<{ slot: number; prioritizationFee: number }>>(
      "getRecentPrioritizationFees",
      [],
    );

    const feesOnly = fees.map((f) => f.prioritizationFee).filter((f) => f > 0);
    feesOnly.sort((a, b) => a - b);

    const median = feesOnly.length > 0 ? feesOnly[Math.floor(feesOnly.length / 2)]! : 0;

    return {
      chain: "solana",
      unit: "micro-lamports/CU",
      safeGasPrice: (feesOnly[0] ?? 0).toString(),
      proposedGasPrice: median.toString(),
      fastGasPrice: (feesOnly[feesOnly.length - 1] ?? 0).toString(),
    };
  }

  override async getBlockInfo(blockNumber: number, chain?: Chain): Promise<BlockInfo> {
    const c = chain ?? "solana";
    if (c !== "solana") throw new UnsupportedChainError(c, "solana");

    const block = await this.rpcCall<BlockInfo_rpc>("getBlock", [
      blockNumber,
      { encoding: "json", transactionDetails: "none", rewards: false },
    ]);

    return {
      number: blockNumber,
      hash: block.blockhash,
      parentHash: block.previousBlockhash,
      timestamp: block.blockTime ? new Date(block.blockTime * 1000).toISOString() : "",
      miner: "",
      gasUsed: "0",
      gasLimit: "0",
      txCount: block.transactions.length,
    };
  }
}

register(Solana, "https://api.mainnet-beta.solana.com");
