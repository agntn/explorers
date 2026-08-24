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

/** An OP_RETURN output opens with the opcode itself, so the hex says so before it is decoded. */
const OP_RETURN_SCRIPT = /^6a/i;

const OP_0 = 0x00;
const OP_PUSHDATA1 = 0x4c;
const OP_PUSHDATA2 = 0x4d;
const OP_PUSHDATA4 = 0x4e;

const OP_1NEGATE = 0x4f;
const OP_RESERVED = 0x50;
const OP_1 = 0x51;
const OP_16 = 0x60;

/** Push opcodes that spell their length out, and how many bytes that length takes. */
const PUSHDATA_WIDTH: Record<number, number> = {
  [OP_PUSHDATA1]: 1,
  [OP_PUSHDATA2]: 2,
  [OP_PUSHDATA4]: 4,
};

/** `ignoreBOM` means "leave a leading U+FEFF in the string", which is where the filter can see it. */
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** Unicode format characters: invisible on screen, which covers the bidi controls as well. */
const FORMAT_CHARACTER = /\p{Cf}/u;

/**
 * Decide whether decoded chain data is worth showing as text.
 *
 * A payload anyone can pay to publish must not steer a terminal, reorder the line that renders it,
 * or hide bytes behind characters nobody can see, because the CLI prints this text straight out.
 * Out of the C0 and C1 control blocks only tab and newline survive. The trade is that a joiner
 * carries meaning in Persian spelling and in emoji sequences, and those payloads arrive as hex.
 */
function isPrintable(text: string): boolean {
  if (FORMAT_CHARACTER.test(text)) return false;

  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 && code !== 0x09 && code !== 0x0a) return false;
    if (code >= 0x7f && code <= 0x9f) return false;
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

/**
 * Value an opcode pushes on its own, for the small constants that carry no bytes after them.
 *
 * Nothing comes back for OP_RESERVED: Bitcoin Core counts it as push-type in `IsPushOnly`, yet it
 * leaves no data behind.
 */
function constantPush(opcode: number): Uint8Array | undefined {
  if (opcode === OP_0) return new Uint8Array();
  if (opcode === OP_1NEGATE) return Uint8Array.of(0x81);
  if (opcode >= OP_1 && opcode <= OP_16) return Uint8Array.of(opcode - OP_1 + 1);
  return undefined;
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

function toPayload(bytes: Uint8Array): OpReturnPayload {
  return { hex: toHex(bytes), text: decodeText(bytes) };
}

/**
 * Read the data pushes of an OP_RETURN output.
 *
 * Any other output yields nothing, and is rejected on the hex so a busy address does not pay to
 * decode thousands of ordinary scripts. The walk covers what Bitcoin Core calls push-only: an
 * opcode below OP_PUSHDATA1 is its own byte count, the small constants push themselves, and
 * anything above OP_16 or a truncated push ends the walk with whatever came before it.
 */
function parseOpReturn(scriptHex: string): OpReturnPayload[] {
  if (!OP_RETURN_SCRIPT.test(scriptHex)) return [];

  const script = hexToBytes(scriptHex);
  if (!script) return [];

  const payloads: OpReturnPayload[] = [];
  let cursor = 1;

  while (cursor < script.length) {
    const opcode = script[cursor]!;
    cursor += 1;

    if (opcode > OP_16) break;
    if (opcode === OP_RESERVED) continue;

    const constant = constantPush(opcode);
    if (constant !== undefined) {
      payloads.push(toPayload(constant));
      continue;
    }

    let length = opcode;
    const width = PUSHDATA_WIDTH[opcode];
    if (width !== undefined) {
      if (cursor + width > script.length) break;
      length = readPushLength(script, cursor, width);
      cursor += width;
    }

    if (cursor + length > script.length) break;

    const payload = script.subarray(cursor, cursor + length);
    cursor += length;
    payloads.push(toPayload(payload));
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
