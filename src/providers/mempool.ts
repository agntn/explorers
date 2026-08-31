/**
 * Mempool.space provider for Bitcoin and compatible forks serving Litecoin and Pepecoin.
 *
 * Public API, no key needed. All three serve address balances and transactions. Litecoin also
 * carries the fee and block endpoints, while Pepecoin does not expose enough data for those reads.
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
  GasUnit,
  BlockInfo,
  TxStatus,
  TokenTransfer,
  OpReturnPayload,
} from "../core/types.js";
import { Provider } from "../core/provider.js";
import { normalizeBaseUrl } from "../core/client.js";
import { NotFoundError, UnsupportedChainError, UnsupportedOperationError } from "../core/errors.js";
import { create as createChain } from "@agntn/chains";
import { formatWei } from "../core/types.js";
import { assertSafePathSegment } from "../core/path-safety.js";
import { getEsploraAddressHistory, getFirstEsploraOutput } from "../core/esplora.js";

const DEFAULT_BASE = "https://mempool.space";

const CHAIN_BASES: Partial<Record<ChainKey, string>> = {
  bitcoin: DEFAULT_BASE,
  litecoin: "https://litecoinspace.org",
  pepecoin: "https://peppool.space",
};

/** Fee rates come back in the chain's smallest unit per virtual byte. */
const FEE_UNITS: Partial<Record<ChainKey, GasUnit>> = {
  bitcoin: "sat/vB",
  litecoin: "litoshi/vB",
};

interface MempoolAddressSummary {
  readonly address: string;
  readonly chain_stats: {
    readonly funded_txo_count: number;
    readonly funded_txo_sum: number | string;
    readonly spent_txo_count: number;
    readonly spent_txo_sum: number | string;
    readonly tx_count: number;
  };
  readonly mempool_stats: {
    readonly funded_txo_count: number;
    readonly funded_txo_sum: number | string;
    readonly spent_txo_count: number;
    readonly spent_txo_sum: number | string;
    readonly tx_count: number;
  };
}

interface MempoolTx {
  readonly txid: string;
  readonly version: number;
  readonly locktime: number;
  readonly vin: ReadonlyArray<{
    readonly txid: string;
    readonly vout: number;
    readonly prevout: {
      readonly scriptpubkey: string;
      readonly scriptpubkey_asm: string;
      readonly scriptpubkey_type: string;
      readonly scriptpubkey_address?: string;
      readonly value: number;
    } | null;
    readonly scriptsig: string;
    readonly sequence: number;
    readonly witness?: readonly string[];
  }>;
  readonly vout: ReadonlyArray<{
    readonly scriptpubkey: string;
    readonly scriptpubkey_asm: string;
    readonly scriptpubkey_type: string;
    readonly scriptpubkey_address?: string;
    readonly value: number;
  }>;
  readonly size: number;
  readonly weight: number;
  readonly fee: number;
  readonly status: {
    readonly confirmed: boolean;
    readonly block_height?: number;
    readonly block_hash?: string;
    readonly block_time?: number;
  };
}

interface MempoolAddressTx {
  readonly txid: string;
  readonly version: number;
  readonly locktime: number;
  readonly vin: ReadonlyArray<{
    readonly txid: string;
    readonly vout: number;
    readonly prevout: {
      readonly scriptpubkey_address?: string;
      readonly value: number;
    } | null;
    readonly scriptsig: string;
    readonly sequence: number;
  }>;
  readonly vout: ReadonlyArray<{
    readonly scriptpubkey?: string;
    readonly scriptpubkey_address?: string;
    readonly value: number;
  }>;
  readonly size: number;
  readonly weight: number;
  readonly fee: number;
  readonly status: {
    readonly confirmed: boolean;
    readonly block_height?: number;
    readonly block_time?: number;
  };
}

interface MempoolFees {
  readonly fastestFee: number;
  readonly halfHourFee: number;
  readonly hourFee: number;
  readonly economyFee: number;
  readonly minimumFee: number;
}

interface MempoolBlock {
  readonly id: string;
  readonly height: number;
  readonly version: number;
  readonly timestamp: number;
  readonly bits: number;
  readonly nonce: number;
  readonly difficulty: number;
  readonly merkle_root: string;
  readonly tx_count: number;
  readonly size: number;
  readonly weight: number;
  readonly previousblockhash: string;
  readonly mediantime: number;
}

/* Convert the smallest unit to a coin string without floating-point arithmetic. */
function satToCoin(sat: number | bigint): string {
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

let utf8: TextDecoder | undefined;

/* `ignoreBOM` means "leave a leading U+FEFF in the string", which is where the filter can see it. */
function decoder(): TextDecoder {
  utf8 ??= new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  return utf8;
}

/** Unicode format characters: invisible on screen, which covers the bidi controls as well. */
const FORMAT_CHARACTER = /\p{Cf}/u;

/*
 * Decide whether decoded chain data is worth showing as text.
 *
 * A payload anyone can pay to publish must not steer a terminal, reorder the line that renders it,
 * or hide bytes behind characters nobody can see, because the CLI prints this text straight out.
 * Out of the C0 and C1 control blocks only tab and newline survive: real messages write paragraphs
 * with them, and the renderers indent a continuation line so it cannot pose as another field. The
 * trade is that a joiner carries meaning in Persian spelling and in emoji sequences, and those
 * payloads arrive as hex.
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

/* Read a little-endian push length. Callers check first that all `width` bytes are there. */
function readPushLength(script: Uint8Array, offset: number, width: number): number {
  let length = 0;
  for (let i = 0; i < width; i += 1) {
    length += (script[offset + i] ?? 0) * 256 ** i;
  }
  return length;
}

/*
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

/* Read a payload as text, leaving binary carriers (Runes, Omni, hashes) without a text reading. */
function decodeText(payload: Uint8Array): string | undefined {
  try {
    const text = decoder().decode(payload);
    return isPrintable(text) ? text : undefined;
  } catch {
    return undefined;
  }
}

function toPayload(bytes: Uint8Array): OpReturnPayload {
  return { hex: toHex(bytes), text: decodeText(bytes) };
}

function dataPush(
  script: Uint8Array,
  cursor: number,
  opcode: number,
): { readonly cursor: number; readonly length: number } | undefined {
  const width = PUSHDATA_WIDTH[opcode];
  if (width === undefined) return { cursor, length: opcode };
  if (cursor + width > script.length) return undefined;
  return { cursor: cursor + width, length: readPushLength(script, cursor, width) };
}

/*
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

    const push = dataPush(script, cursor, opcode);
    if (!push || push.cursor + push.length > script.length) break;

    const payload = script.subarray(push.cursor, push.cursor + push.length);
    cursor = push.cursor + push.length;
    payloads.push(toPayload(payload));
  }

  return payloads;
}

/* Gather the OP_RETURN payloads of all outputs, or nothing when the transaction carries none. */
function collectOpReturns(
  vout: readonly { readonly scriptpubkey?: string }[],
): OpReturnPayload[] | undefined {
  const payloads = vout.flatMap((out) => (out.scriptpubkey ? parseOpReturn(out.scriptpubkey) : []));
  return payloads.length > 0 ? payloads : undefined;
}

function mempoolTimestamp(status: Readonly<MempoolAddressTx["status"]>): string | undefined {
  return status.block_time ? new Date(status.block_time * 1000).toISOString() : undefined;
}

function peppoolHistoryPath(encodedAddress: string, encodedCursor: string): string {
  return `/api/address/${encodedAddress}/txs?after_txid=${encodedCursor}`;
}

function mempoolAddressTotals(
  raw: Readonly<MempoolAddressTx>,
  address: string,
): { readonly input: number; readonly output: number } {
  const input = raw.vin
    .filter((item) => item.prevout?.scriptpubkey_address === address)
    .reduce((sum, item) => sum + (item.prevout?.value ?? 0), 0);
  const output = raw.vout
    .filter((item) => item.scriptpubkey_address === address)
    .reduce((sum, item) => sum + item.value, 0);
  return { input, output };
}

function mempoolSendingParties(
  raw: Readonly<MempoolAddressTx>,
  address: string,
): { readonly from: string; readonly to: string } {
  const sender = raw.vin.find((item) => item.prevout?.scriptpubkey_address === address);
  const recipient = raw.vout.find((item) => item.scriptpubkey_address !== address);
  return {
    from: sender?.prevout?.scriptpubkey_address ?? address,
    to: recipient?.scriptpubkey_address ?? address,
  };
}

function mempoolAddressParties(
  raw: Readonly<MempoolAddressTx>,
  address: string,
  isSend: boolean,
): { readonly from: string; readonly to: string } {
  if (isSend) return mempoolSendingParties(raw, address);
  return { from: raw.vin[0]?.prevout?.scriptpubkey_address ?? "unknown", to: address };
}

function mapTx(raw: Readonly<MempoolAddressTx>, address: string): Transaction {
  const totals = mempoolAddressTotals(raw, address);
  const netSat = totals.output - totals.input;
  const isSend = totals.input > 0;
  const transferredSat = isSend ? Math.max(0, Math.abs(netSat) - raw.fee) : netSat;
  const { from, to } = mempoolAddressParties(raw, address, isSend);

  return {
    hash: raw.txid,
    blockNumber: raw.status.block_height ?? 0,
    timestamp: mempoolTimestamp(raw.status),
    from,
    to: to ?? null,
    value: transferredSat.toString(),
    valueFormatted: satToCoin(transferredSat),
    fee: raw.fee.toString(),
    status: (raw.status.confirmed ? "success" : "pending") as TxStatus,
    isContractInteraction: false,
    tokenTransfers: [] as TokenTransfer[],
    opReturn: collectOpReturns(raw.vout),
    raw: raw as unknown as Record<string, unknown>,
  };
}

export class Mempool extends Provider {
  static readonly key = "mempool";

  private baseUrl: string | undefined;
  private defaultChain: ChainKey;

  constructor(config: Readonly<ProviderConfig>) {
    super(config);
    this.baseUrl = config.baseUrl ? normalizeBaseUrl(config.baseUrl) : undefined;
    this.defaultChain = config.defaultChain ?? "bitcoin";
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

  /* Chain membership decides support; an explicit `baseUrl` then overrides the host. */
  private base(chain: ChainKey): string {
    const base = CHAIN_BASES[chain];
    if (!base) throw new UnsupportedChainError(chain, "mempool");
    return this.baseUrl ?? base;
  }

  private async api<T>(chain: ChainKey, path: string): Promise<T> {
    return this.getJSON<T>(`${this.base(chain)}${path}`);
  }

  async getBalance(address: string, chain?: ChainKey): Promise<Balance> {
    const c = chain ?? this.defaultChain;

    assertSafePathSegment(address, "address");
    const data = await this.api<MempoolAddressSummary>(
      c,
      `/api/address/${encodeURIComponent(address)}`,
    );

    const fundedSat = BigInt(data.chain_stats.funded_txo_sum);
    const spentSat = BigInt(data.chain_stats.spent_txo_sum);
    const balanceSat = fundedSat - spentSat;

    return this.snapshotBalance({
      address,
      chain: c,
      balance: balanceSat.toString(),
      balanceFormatted: satToCoin(balanceSat),
      funded: fundedSat.toString(),
      spent: spentSat.toString(),
      symbol: createChain(c).symbol,
    });
  }

  async getTxHistory(
    address: string,
    chain?: ChainKey,
    options?: Readonly<TxHistoryOptions>,
  ): Promise<Transaction[]> {
    const c = chain ?? this.defaultChain;
    const transactions = await getEsploraAddressHistory(
      address,
      options?.limit,
      async (path) => this.api<MempoolAddressTx[]>(c, path),
      c === "pepecoin" ? peppoolHistoryPath : undefined,
    );

    return transactions.map((tx) => mapTx(tx, address));
  }

  override async getTxDetail(hash: string, chain?: ChainKey): Promise<Transaction> {
    const c = chain ?? this.defaultChain;

    assertSafePathSegment(hash, "tx hash");
    const data = await this.api<MempoolTx>(c, `/api/tx/${encodeURIComponent(hash)}`);

    const output = getFirstEsploraOutput(data.vout);
    const fromAddr = data.vin[0]?.prevout?.scriptpubkey_address ?? "unknown";

    return {
      hash: data.txid,
      blockNumber: data.status.block_height ?? 0,
      timestamp: mempoolTimestamp(data.status),
      from: fromAddr,
      to: output.address,
      value: output.value.toString(),
      valueFormatted: satToCoin(output.value),
      fee: data.fee.toString(),
      status: (data.status.confirmed ? "success" : "pending") as TxStatus,
      isContractInteraction: false,
      tokenTransfers: [],
      opReturn: collectOpReturns(data.vout),
      raw: data as unknown as Record<string, unknown>,
    };
  }

  override async getGasData(chain?: ChainKey): Promise<GasData> {
    const c = chain ?? this.defaultChain;
    if (c === "pepecoin") throw new UnsupportedOperationError("getGasData", this.name);

    const fees = await this.api<MempoolFees>(c, "/api/v1/fees/recommended");

    return {
      chain: c,
      unit: FEE_UNITS[c] ?? "sat/vB",
      safeGasPrice: fees.economyFee.toString(),
      proposedGasPrice: fees.halfHourFee.toString(),
      fastGasPrice: fees.fastestFee.toString(),
      priorityFee: fees.minimumFee.toString(),
    };
  }

  override async getBlockInfo(blockNumber: number, chain?: ChainKey): Promise<BlockInfo> {
    const c = chain ?? this.defaultChain;
    if (c === "pepecoin") throw new UnsupportedOperationError("getBlockInfo", this.name);

    assertSafePathSegment(String(blockNumber), "block number");
    const blocks = await this.api<MempoolBlock[]>(
      c,
      `/api/blocks/${encodeURIComponent(String(blockNumber))}`,
    );
    const block = blocks.find((candidate) => candidate.height === blockNumber);
    if (!block) throw new NotFoundError(`Block ${blockNumber}`, "mempool");

    return {
      number: block.height,
      hash: block.id,
      parentHash: block.previousblockhash,
      timestamp: new Date(block.timestamp * 1000).toISOString(),
      miner: "",
      gasUsed: block.size.toString(),
      gasLimit: block.weight.toString(),
      txCount: block.tx_count,
    };
  }
}
