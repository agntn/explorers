/**
 * Mempool.space provider — Bitcoin block explorer
 *
 * Public API, no key needed. Best-in-class Bitcoin data: address balances, tx history, UTXO info,
 * fee estimates, block info.
 *
 * https://mempool.space/docs/api
 */

import type {
  ProviderCapabilities,
  ProviderConfig,
  ChainKey,
  Balance,
  Transaction,
  TxHistoryOptions,
  GasData,
  BlockInfo,
  TxStatus,
  TokenTransfer,
  OpReturnPayload,
} from "../core/types.js";
import { Provider } from "../core/provider.js";
import { normalizeBaseUrl } from "../core/client.js";
import { UnsupportedChainError } from "../core/errors.js";
import { register } from "../core/registry.js";
import { clampMaxResults, formatWei } from "../core/types.js";
import { assertSafePathSegment } from "../core/path-safety.js";

const DEFAULT_BASE = "https://mempool.space";

interface MempoolAddressSummary {
  address: string;
  chain_stats: {
    funded_txo_count: number;
    funded_txo_sum: number;
    spent_txo_count: number;
    spent_txo_sum: number;
    tx_count: number;
  };
  mempool_stats: {
    funded_txo_count: number;
    funded_txo_sum: number;
    spent_txo_count: number;
    spent_txo_sum: number;
    tx_count: number;
  };
}

interface MempoolTx {
  txid: string;
  version: number;
  locktime: number;
  vin: Array<{
    txid: string;
    vout: number;
    prevout: {
      scriptpubkey: string;
      scriptpubkey_asm: string;
      scriptpubkey_type: string;
      scriptpubkey_address?: string;
      value: number;
    } | null;
    scriptsig: string;
    sequence: number;
    witness?: string[];
  }>;
  vout: Array<{
    scriptpubkey: string;
    scriptpubkey_asm: string;
    scriptpubkey_type: string;
    scriptpubkey_address?: string;
    value: number;
  }>;
  size: number;
  weight: number;
  fee: number;
  status: {
    confirmed: boolean;
    block_height?: number;
    block_hash?: string;
    block_time?: number;
  };
}

interface MempoolAddressTx {
  txid: string;
  version: number;
  locktime: number;
  vin: Array<{
    txid: string;
    vout: number;
    prevout: {
      scriptpubkey_address?: string;
      value: number;
    } | null;
    scriptsig: string;
    sequence: number;
  }>;
  vout: Array<{
    scriptpubkey?: string;
    scriptpubkey_address?: string;
    value: number;
  }>;
  size: number;
  weight: number;
  fee: number;
  status: {
    confirmed: boolean;
    block_height?: number;
    block_time?: number;
  };
}

interface MempoolFees {
  fastestFee: number;
  halfHourFee: number;
  hourFee: number;
  economyFee: number;
  minimumFee: number;
}

interface MempoolBlock {
  id: string;
  height: number;
  version: number;
  timestamp: number;
  bits: number;
  nonce: number;
  difficulty: number;
  merkle_root: string;
  tx_count: number;
  size: number;
  weight: number;
  previousblockhash: string;
  mediantime: number;
}

/** Convert satoshis to a BTC string without floating-point arithmetic. */
function satToBtc(sat: number): string {
  return formatWei(String(sat), 8);
}

const OP_RETURN = 0x6a;
const MAX_DIRECT_PUSH = 0x4b;

const OP_PUSHDATA1 = 0x4c;
const OP_PUSHDATA2 = 0x4d;
const OP_PUSHDATA4 = 0x4e;

/** Push opcodes that spell their length out, and how many bytes that length takes. */
const PUSHDATA_WIDTH: Record<number, number> = {
  [OP_PUSHDATA1]: 1,
  [OP_PUSHDATA2]: 2,
  [OP_PUSHDATA4]: 4,
};

const utf8 = new TextDecoder("utf-8", { fatal: true });

/**
 * Decide whether decoded chain data is safe to print.
 *
 * Out of the C0 and C1 control blocks only tab and newline survive, and the bidi overrides go with
 * them. A payload anyone can pay to publish must not steer a terminal or reorder the line that
 * renders it, and the CLI prints this text straight out.
 */
function isPrintable(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 && code !== 0x09 && code !== 0x0a) return false;
    if (code >= 0x7f && code <= 0x9f) return false;
    if (code >= 0x200e && code <= 0x200f) return false;
    if (code >= 0x202a && code <= 0x202e) return false;
    if (code >= 0x2066 && code <= 0x2069) return false;
  }

  return true;
}

function hexToBytes(hex: string): Uint8Array | undefined {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) return undefined;

  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Read a little-endian push length. Callers check first that all `width` bytes are there. */
function readPushLength(script: Uint8Array, offset: number, width: number): number {
  let length = 0;
  for (let i = 0; i < width; i += 1) {
    length += (script[offset + i] ?? 0) * 256 ** i;
  }
  return length;
}

/** Read a payload as text, leaving binary carriers (Runes, Omni, hashes) without a text reading. */
function decodeText(payload: Uint8Array): string | undefined {
  try {
    const text = utf8.decode(payload);
    return isPrintable(text) ? text : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read the data pushes of an OP_RETURN output.
 *
 * Any other output yields nothing. The walk stops at the first byte that is not a data push, so a
 * truncated or non-standard tail still returns whatever was pushed before it.
 */
function parseOpReturn(scriptHex: string): OpReturnPayload[] {
  const script = hexToBytes(scriptHex);
  if (!script || script[0] !== OP_RETURN) return [];

  const payloads: OpReturnPayload[] = [];
  let cursor = 1;

  while (cursor < script.length) {
    const opcode = script[cursor]!;
    cursor += 1;

    let length: number;
    if (opcode >= 1 && opcode <= MAX_DIRECT_PUSH) {
      length = opcode;
    } else {
      const width = PUSHDATA_WIDTH[opcode];
      if (width === undefined || cursor + width > script.length) break;
      length = readPushLength(script, cursor, width);
      cursor += width;
    }

    if (cursor + length > script.length) break;

    const payload = script.subarray(cursor, cursor + length);
    cursor += length;
    payloads.push({ hex: toHex(payload), text: decodeText(payload) });
  }

  return payloads;
}

/** Gather the OP_RETURN payloads of all outputs, or nothing when the transaction carries none. */
function collectOpReturns(vout: Array<{ scriptpubkey?: string }>): OpReturnPayload[] | undefined {
  const payloads = vout.flatMap((out) => (out.scriptpubkey ? parseOpReturn(out.scriptpubkey) : []));
  return payloads.length > 0 ? payloads : undefined;
}

function mapTx(raw: MempoolAddressTx, address: string): Transaction {
  // Determine direction: is this address receiving or sending?
  const totalIn = raw.vin
    .filter((v) => v.prevout?.scriptpubkey_address === address)
    .reduce((sum, v) => sum + (v.prevout?.value ?? 0), 0);
  const totalOut = raw.vout
    .filter((v) => v.scriptpubkey_address === address)
    .reduce((sum, v) => sum + v.value, 0);

  const netSat = totalOut - totalIn;
  const isSend = totalIn > 0;
  const transferredSat = isSend ? Math.max(0, Math.abs(netSat) - raw.fee) : netSat;

  // Find the primary counterparty
  const from = isSend
    ? (raw.vin.find((v) => v.prevout?.scriptpubkey_address === address)?.prevout
        ?.scriptpubkey_address ?? address)
    : (raw.vin[0]?.prevout?.scriptpubkey_address ?? "unknown");
  const to = isSend
    ? (raw.vout.find((v) => v.scriptpubkey_address !== address)?.scriptpubkey_address ?? address)
    : address;

  return {
    hash: raw.txid,
    blockNumber: raw.status.block_height ?? 0,
    timestamp: raw.status.block_time
      ? new Date(raw.status.block_time * 1000).toISOString()
      : undefined,
    from,
    to: to ?? null,
    value: transferredSat.toString(),
    valueFormatted: satToBtc(transferredSat),
    fee: raw.fee.toString(),
    status: (raw.status.confirmed ? "success" : "pending") as TxStatus,
    isContractInteraction: false,
    tokenTransfers: [] as TokenTransfer[],
    opReturn: collectOpReturns(raw.vout),
    raw: raw as unknown as Record<string, unknown>,
  };
}

class Mempool extends Provider {
  static readonly key = "mempool";
  static readonly chains: readonly ChainKey[] = ["bitcoin"];

  private baseUrl: string;

  constructor(config: ProviderConfig) {
    super(config);
    this.baseUrl = normalizeBaseUrl(config.baseUrl ?? DEFAULT_BASE);
  }
  get capabilities(): ProviderCapabilities {
    return {
      balances: true,
      txHistory: true,
      txDetail: true,
      contractInfo: false,
      tokenBalances: false,
      tokenTransfers: false,
      gasData: true,
      blockInfo: true,
    };
  }

  private async api<T>(path: string): Promise<T> {
    return this.getJSON<T>(`${this.baseUrl}${path}`);
  }

  async getBalance(address: string, chain?: ChainKey): Promise<Balance> {
    const c = chain ?? "bitcoin";
    if (c !== "bitcoin") throw new UnsupportedChainError(c, "mempool");

    assertSafePathSegment(address, "address");
    const data = await this.api<MempoolAddressSummary>(
      `/api/address/${encodeURIComponent(address)}`,
    );

    const fundedSat = data.chain_stats.funded_txo_sum;
    const spentSat = data.chain_stats.spent_txo_sum;
    const balanceSat = fundedSat - spentSat;

    return {
      address,
      chain: "bitcoin",
      balance: balanceSat.toString(),
      balanceFormatted: satToBtc(balanceSat),
      symbol: "BTC",
    };
  }

  async getTxHistory(
    address: string,
    chain?: ChainKey,
    options?: TxHistoryOptions,
  ): Promise<Transaction[]> {
    const c = chain ?? "bitcoin";
    if (c !== "bitcoin") throw new UnsupportedChainError(c, "mempool");

    const limit = clampMaxResults(options?.limit);
    assertSafePathSegment(address, "address");
    const data = await this.api<MempoolAddressTx[]>(
      `/api/address/${encodeURIComponent(address)}/txs`,
    );

    return data.slice(0, limit).map((tx) => mapTx(tx, address));
  }

  override async getTxDetail(hash: string, chain?: ChainKey): Promise<Transaction> {
    const c = chain ?? "bitcoin";
    if (c !== "bitcoin") throw new UnsupportedChainError(c, "mempool");

    assertSafePathSegment(hash, "tx hash");
    const data = await this.api<MempoolTx>(`/api/tx/${encodeURIComponent(hash)}`);

    const totalOut = data.vout.reduce((sum, v) => sum + v.value, 0);
    const fromAddr = data.vin[0]?.prevout?.scriptpubkey_address ?? "unknown";
    const toAddr = data.vout[0]?.scriptpubkey_address ?? null;

    return {
      hash: data.txid,
      blockNumber: data.status.block_height ?? 0,
      timestamp: data.status.block_time
        ? new Date(data.status.block_time * 1000).toISOString()
        : undefined,
      from: fromAddr,
      to: toAddr,
      value: totalOut.toString(),
      valueFormatted: satToBtc(totalOut),
      fee: data.fee.toString(),
      status: (data.status.confirmed ? "success" : "pending") as TxStatus,
      isContractInteraction: false,
      tokenTransfers: [],
      opReturn: collectOpReturns(data.vout),
      raw: data as unknown as Record<string, unknown>,
    };
  }

  override async getGasData(chain?: ChainKey): Promise<GasData> {
    const c = chain ?? "bitcoin";
    if (c !== "bitcoin") throw new UnsupportedChainError(c, "mempool");

    const fees = await this.api<MempoolFees>("/api/v1/fees/recommended");

    return {
      chain: "bitcoin",
      unit: "sat/vB",
      safeGasPrice: fees.economyFee.toString(),
      proposedGasPrice: fees.halfHourFee.toString(),
      fastGasPrice: fees.fastestFee.toString(),
      priorityFee: fees.minimumFee.toString(),
    };
  }

  override async getBlockInfo(blockNumber: number, chain?: ChainKey): Promise<BlockInfo> {
    const c = chain ?? "bitcoin";
    if (c !== "bitcoin") throw new UnsupportedChainError(c, "mempool");

    // Get block hash from height, then fetch block details.
    // Block numbers are ASCII hex from mempool.space — no traversal concern,
    // but assert anyway for symmetry with sibling providers.
    assertSafePathSegment(String(blockNumber), "block number");
    const blockHash = await this.api<string>(
      `/api/block-height/${encodeURIComponent(String(blockNumber))}`,
    );
    const data = await this.api<MempoolBlock>(`/api/block/${encodeURIComponent(blockHash)}`);

    return {
      number: data.height,
      hash: data.id,
      parentHash: data.previousblockhash,
      timestamp: new Date(data.timestamp * 1000).toISOString(),
      miner: "", // Mempool doesn't provide miner directly
      gasUsed: data.size.toString(),
      gasLimit: data.weight.toString(),
      txCount: data.tx_count,
    };
  }
}

register(Mempool, "https://mempool.space");
