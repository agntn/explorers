/**
 * Aptos provider — Aptos Labs public API
 *
 * Public REST API, no key needed. APT balance, tx history, block info.
 * Aptos uses octas: 1 APT = 100,000,000 octas.
 *
 * https://aptos.dev/en/build/apis
 */

import type {
  ProviderCapabilities,
  ProviderConfig,
  Chain,
  Balance,
  Transaction,
  TxHistoryOptions,
  BlockInfo,
  TxStatus,
} from "../core/types.js";
import { Provider } from "../core/provider.js";
import { normalizeBaseUrl } from "../core/client.js";
import { UnsupportedChainError } from "../core/errors.js";
import { register } from "../core/registry.js";
import { clampMaxResults, formatWei, multiplyIntegerStrings } from "../core/types.js";

import { assertSafePathSegment } from "../core/path-safety.js";
const DEFAULT_BASE = "https://api.mainnet.aptoslabs.com/v1";

interface AptosTransaction {
  type: string;
  version: string;
  hash: string;
  state_change_hash: string;
  event_root_hash: string;
  state_checkpoint_hash: string | null;
  gas_used: string;
  success: boolean;
  vm_status: string;
  accumulator_root_hash: string;
  changes: unknown[];
  sender: string;
  sequence_number: string;
  max_gas_amount: string;
  gas_unit_price: string;
  expiration_timestamp_secs: string;
  payload: {
    type: string;
    function?: string;
    type_arguments: string[];
    arguments: string[];
  };
  events: Array<{
    type: string;
    data: Record<string, unknown>;
  }>;
  timestamp: string;
}

interface AptosBlock {
  block_height: string;
  block_hash: string;
  block_timestamp: string;
  first_version: string;
  last_version: string;
  transactions: AptosTransaction[];
}

function mapTx(raw: AptosTransaction): Transaction {
  const payload = raw.payload;
  const functionName = payload.function?.split("::").at(-1);
  const isTransfer =
    payload.type === "entry_function_payload" && functionName?.startsWith("transfer") === true;
  let value = "0";

  if (isTransfer) {
    const amount = payload.arguments[1];
    if (typeof amount === "string" && /^\d+$/.test(amount)) {
      value = amount;
    }
  }

  const recipient = isTransfer ? (payload.arguments[0] ?? null) : null;

  return {
    hash: raw.hash,
    blockNumber: Number(raw.version),
    timestamp: new Date(Number(raw.timestamp) / 1000).toISOString(),
    from: raw.sender,
    to: recipient,
    value,
    valueFormatted: formatWei(value, 8),
    gasUsed: raw.gas_used,
    gasPrice: raw.gas_unit_price,
    status: (raw.success ? "success" : "failed") as TxStatus,
    fee: multiplyIntegerStrings(raw.gas_used, raw.gas_unit_price),
    isContractInteraction: !isTransfer,
    tokenTransfers: [],
  };
}

class Aptos extends Provider {
  private baseUrl: string;

  constructor(config: ProviderConfig) {
    super(config);
    this.baseUrl = normalizeBaseUrl(config.baseUrl ?? DEFAULT_BASE);
  }

  static readonly providerName = "aptos";
  readonly name = Aptos.providerName;

  get capabilities(): ProviderCapabilities {
    return {
      balances: true,
      txHistory: true,
      txDetail: true,
      contractInfo: false,
      tokenBalances: false,
      gasData: false,
      blockInfo: true,
    };
  }

  async getBalance(address: string, chain?: Chain): Promise<Balance> {
    const c = chain ?? "aptos";
    if (c !== "aptos") throw new UnsupportedChainError(c, "aptos");

    // Use view function to get APT balance
    const result = await this.postJSON<string[]>(`${this.baseUrl}/view`, {
      function: "0x1::coin::balance",
      type_arguments: ["0x1::aptos_coin::AptosCoin"],
      arguments: [address],
    });

    const octas = result?.[0] ?? "0";

    return {
      address,
      chain: "aptos",
      balance: octas,
      balanceFormatted: formatWei(octas, 8),
      symbol: "APT",
    };
  }

  async getTxHistory(
    address: string,
    chain?: Chain,
    options?: TxHistoryOptions,
  ): Promise<Transaction[]> {
    const c = chain ?? "aptos";
    if (c !== "aptos") throw new UnsupportedChainError(c, "aptos");

    const limit = clampMaxResults(options?.limit);

    assertSafePathSegment(address, "address");
    const txs = await this.getJSON<AptosTransaction[]>(
      `${this.baseUrl}/accounts/${encodeURIComponent(address)}/transactions?limit=${limit}`,
    );

    if (!Array.isArray(txs)) return [];

    return txs.map(mapTx);
  }

  override async getTxDetail(hash: string, chain?: Chain): Promise<Transaction> {
    const c = chain ?? "aptos";
    if (c !== "aptos") throw new UnsupportedChainError(c, "aptos");

    assertSafePathSegment(hash, "tx hash");
    const tx = await this.getJSON<AptosTransaction>(
      `${this.baseUrl}/transactions/by_hash/${encodeURIComponent(hash)}`,
    );

    return mapTx(tx);
  }

  override async getBlockInfo(blockNumber: number, chain?: Chain): Promise<BlockInfo> {
    const c = chain ?? "aptos";
    if (c !== "aptos") throw new UnsupportedChainError(c, "aptos");

    assertSafePathSegment(String(blockNumber), "block number");
    const block = await this.getJSON<AptosBlock>(
      `${this.baseUrl}/blocks/by_height/${encodeURIComponent(String(blockNumber))}`,
    );

    return {
      number: Number(block.block_height),
      hash: block.block_hash,
      parentHash: "",
      timestamp: new Date(Number(block.block_timestamp) / 1000).toISOString(),
      miner: "",
      gasUsed: "0",
      gasLimit: "0",
      txCount: Number(BigInt(block.last_version) - BigInt(block.first_version) + 1n),
    };
  }
}

register(Aptos, "https://api.mainnet.aptoslabs.com/v1");
