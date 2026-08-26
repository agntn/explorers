/** Explorers — Unified block explorer provider types */

import { getChain } from "@agntn/chains";
import type { ChainKey } from "@agntn/chains";

export type { ChainKey } from "@agntn/chains";

/** Transaction status */
export type TxStatus = "success" | "failed" | "pending";

/** Normalized fungible-token transfer */
export interface TokenTransfer {
  /** Token contract address */
  contract: string;
  /** Token symbol */
  symbol: string;
  /** Token name */
  name?: string;
  /** Token decimals */
  decimals: number;
  /** Transfer amount (raw, string to avoid float) */
  value: string;
  /** Human-readable amount */
  valueFormatted: string;
  /** From address */
  from: string;
  /** To address */
  to: string;
  /** Transaction hash */
  txHash: string;
  /** Block number */
  blockNumber: number;
  /** Timestamp (ISO) */
  timestamp?: string;
}

/** One data push carried by an OP_RETURN output */
export interface OpReturnPayload {
  /** Pushed bytes as lowercase hex, without the opcode and the push prefix */
  hex: string;
  /** UTF-8 reading of the payload, present only when the bytes are printable text */
  text?: string;
}

/** Normalized transaction */
export interface Transaction {
  /** Transaction hash */
  hash: string;
  /** Block number */
  blockNumber: number;
  /** Timestamp (ISO) */
  timestamp?: string;
  /** Sender */
  from: string;
  /** Recipient (null for contract creation) */
  to: string | null;
  /** Value in the chain's smallest native unit */
  value: string;
  /** Human-readable value in native token */
  valueFormatted: string;
  /** Execution units consumed, when the chain exposes them */
  gasUsed?: string;
  /** Price per execution unit in the chain's smallest native unit */
  gasPrice?: string;
  /** Total transaction fee in the chain's smallest native unit */
  fee?: string;
  /** Transaction status */
  status: TxStatus;
  /** Method ID (first 4 bytes of input data) */
  methodId?: string;
  /** Function name if decoded */
  functionName?: string;
  /** Whether this is a contract interaction */
  isContractInteraction: boolean;
  /** Token transfers within this tx */
  tokenTransfers: TokenTransfer[];
  /** Data pushed by the OP_RETURN outputs, on chains that carry them */
  opReturn?: OpReturnPayload[];
  /** Raw provider data */
  raw?: Record<string, unknown>;
}

/** Normalized address balance */
export interface Balance {
  /** Address */
  address: string;
  /** Chain */
  chain: ChainKey;
  /** Balance in the chain's smallest native unit */
  balance: string;
  /** Human-readable balance */
  balanceFormatted: string;
  /** Native token symbol (ETH, BNB, etc.) */
  symbol: string;
}

/** ERC-20 token holding for an address */
export interface TokenBalance {
  /** Token contract address */
  contract: string;
  /** Token symbol */
  symbol: string;
  /** Token name */
  name?: string;
  /** Token decimals */
  decimals: number;
  /** Balance (raw string) */
  balance: string;
  /** Human-readable balance */
  balanceFormatted: string;
  /** USD price if available */
  priceUsd?: number;
  /** USD value if available */
  valueUsd?: number;
}

/** Contract information */
export interface ContractInfo {
  /** Contract address */
  address: string;
  /** Whether verified (source code available) */
  isVerified: boolean;
  /** Whether it's a proxy contract */
  isProxy?: boolean;
  /** Implementation address if proxy */
  implementationAddress?: string;
  /** Contract name */
  name?: string;
  /** Compiler version */
  compilerVersion?: string;
  /** Contract ABI (JSON string) */
  abi?: string;
  /** Source code */
  sourceCode?: string;
  /** Whether it's a token (ERC-20/721/1155) */
  isToken?: boolean;
  /** Token standard if applicable */
  tokenStandard?: "ERC-20" | "ERC-721" | "ERC-1155";
  /** Creator address */
  creator?: string;
  /** Creation transaction hash */
  creationTxHash?: string;
}

/** Unit used by a provider's fee suggestions. */
export type GasUnit = "gwei" | "sat/vB" | "litoshi/vB" | "micro-lamports/CU" | "MIST";

/** Gas or fee-market data in provider-native units. */
export interface GasData {
  /** Chain */
  chain: ChainKey;
  /** Unit shared by all price fields in this result. */
  unit: GasUnit;
  /** Safe/low price */
  safeGasPrice?: string;
  /** Proposed/average price */
  proposedGasPrice?: string;
  /** Fast price */
  fastGasPrice?: string;
  /** Base fee */
  baseFee?: string;
  /** Suggested priority fee */
  priorityFee?: string;
}

/** Block info */
export interface BlockInfo {
  /** Block number */
  number: number;
  /** Block hash */
  hash: string;
  /** Parent hash */
  parentHash: string;
  /** Timestamp (ISO) */
  timestamp: string;
  /** Miner/validator address */
  miner: string;
  /** Gas used */
  gasUsed: string;
  /** Gas limit */
  gasLimit: string;
  /** Number of transactions */
  txCount: number;
  /** Base fee per gas (EIP-1559) */
  baseFee?: string;
}

/** Feature flags for operations available on a provider at runtime. */
export interface ProviderCapabilities {
  /** Can get address balances */
  balances: boolean;
  /** Can list transaction history */
  txHistory: boolean;
  /** Can get single tx detail */
  txDetail: boolean;
  /** Can get contract info (ABI, source) */
  contractInfo: boolean;
  /** Can get token holdings for address */
  tokenBalances: boolean;
  /** Can list token transfers involving an address */
  tokenTransfers: boolean;
  /** Can get gas estimates */
  gasData: boolean;
  /** Can get block info */
  blockInfo: boolean;
}

/** Options for tx history */
export interface TxHistoryOptions {
  /** Start block (inclusive) */
  startBlock?: number;
  /** End block (inclusive) */
  endBlock?: number;
  /** Sort order */
  sort?: "asc" | "desc";
  /** Max results */
  limit?: number;
  /** Page number (1-indexed) */
  page?: number;
}

/** Options for token transfer history */
export interface TokenTransferOptions extends TxHistoryOptions {
  /** Only include transfers of this token contract */
  token?: string;
}

/** Options for token balances */
export interface TokenBalanceOptions {
  /** Only include tokens with non-zero balance */
  nonZeroOnly?: boolean;
}

/** Shared construction options. Providers ignore fields they cannot use. */
export interface ProviderConfig {
  /** API key for providers that require one. */
  apiKey?: string;
  /** Custom API or RPC base URL when the provider supports an override. */
  baseUrl?: string;
  /** Request timeout in milliseconds. Defaults to 15 seconds. */
  timeout?: number;
  /** Fallback chain for multi-chain providers. */
  defaultChain?: ChainKey;
}

/**
 * Round a requested result limit and keep it inside the provider's range.
 *
 * A missing or zero limit uses `max`.
 */
export function clampMaxResults(limit?: number, max = 100): number {
  if (!limit) return max;
  return Math.min(Math.max(1, Math.round(limit)), max);
}

/** Convert a unix timestamp in seconds to an ISO 8601 string. */
export function toTimestamp(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

/**
 * Format a raw integer amount using token decimals, without float rounding.
 *
 * @example
 *   ```ts
 *   formatWei("1234500000000000000"); // '1.2345'
 *   ```
 */
export function formatWei(wei: string | bigint, decimals = 18): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new RangeError(`Invalid decimals: ${decimals}`);
  }
  const w = typeof wei === "string" ? BigInt(wei) : wei;
  const negative = w < 0n;
  const abs = negative ? -w : w;
  const base = 10n ** BigInt(decimals);
  const intPart = abs / base;
  const fracPart = abs % base;
  const fracStr = fracPart.toString().padStart(decimals, "0").replace(/0+$/, "");
  const result = fracStr ? `${intPart}.${fracStr}` : `${intPart}`;
  return negative ? `-${result}` : result;
}

/**
 * Convert a hexadecimal integer into a decimal string.
 *
 * @example
 *   ```ts
 *   hexToWei("0xff"); // '255'
 *   ```
 */
export function hexToWei(hex: string): string {
  return BigInt(hex).toString();
}

/** Multiply decimal integer strings without crossing the IEEE-754 boundary. */
export function multiplyIntegerStrings(left: string, right: string): string {
  return (BigInt(left) * BigInt(right)).toString();
}

/**
 * Normalize a canonical chain key, display name, or common CLI alias.
 *
 * Missing values default to `ethereum`. Unknown values are rejected, an empty string included, so a
 * typo cannot silently query the wrong network.
 *
 * @example
 *   ```ts
 *   normalizeChain("arb"); // 'arbitrum'
 *   ```
 */
export function normalizeChain(input?: string): ChainKey {
  try {
    return getChain(input).key;
  } catch {
    throw new RangeError(`Unknown chain: ${input}`);
  }
}
