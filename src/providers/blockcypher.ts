/**
 * BlockCypher provider for Bitcoin, Litecoin and Dogecoin.
 *
 * Keyless at 3 requests a second and 100 an hour, so it suits a second opinion more than a crawl.
 *
 * https://www.blockcypher.com/dev/bitcoin/
 */

import { getChain } from "@agntn/chains";
import { z } from "zod";
import { Provider } from "../core/provider.ts";
import { buildQuery, normalizeBaseUrl } from "../core/client.ts";
import { esploraFeedAddress } from "../core/esplora.ts";
import { ExplorerError, NotFoundError, UnsupportedChainError } from "../core/errors.ts";
import { collectInscriptions, collectOpReturns } from "../core/script.ts";
import { formatWei, historyPage } from "../core/types.ts";
import type {
  Balance,
  BlockInfo,
  ChainKey,
  ProviderCapabilities,
  ProviderConfig,
  Transaction,
  TxHistoryOptions,
  Utxo,
} from "../core/types.ts";

const DEFAULT_BASE = "https://api.blockcypher.com/v1";

const NETWORKS: Readonly<Partial<Record<ChainKey, string>>> = {
  bitcoin: "btc/main",
  litecoin: "ltc/main",
  dogecoin: "doge/main",
};

const DECIMALS = 8;

/** Inputs and outputs read per transaction, since BlockCypher stops at 20 unless told otherwise. */
const IO_LIMIT = 1000;

/** The most transactions `/full` returns in one page. */
const HISTORY_PAGE = 50;

/** History reads one call may spend out of the keyless hundred an hour. */
const HISTORY_READS = 4;

/** The most unspent outputs `/addrs` returns in one page. */
const UTXO_PAGE = 2000;

const UTXO_READS = 3;

function networkOf(chain: ChainKey): string {
  const network = NETWORKS[chain];
  if (network === undefined) throw new UnsupportedChainError(chain, BlockCypher.key);
  return network;
}

/* Checked before the request, so a typo costs nothing from the hourly budget. */
function feedAddress(address: string, chain: ChainKey): string {
  networkOf(chain);
  try {
    getChain(chain).assertAddress(address);
  } catch {
    throw new ExplorerError(`Invalid ${getChain(chain).name} address`, BlockCypher.key);
  }
  return esploraFeedAddress(address);
}

function assertTxid(hash: string): void {
  if (!/^[0-9a-fA-F]{64}$/.test(hash))
    throw new ExplorerError("Invalid transaction hash", BlockCypher.key);
}

/* Satoshi amounts arrive as JSON integers, and the HTTP client keeps one past 2^53 as a string. */
function amount() {
  return z.union([z.number().int(), z.string().regex(/^-?\d+$/)]).transform(BigInt);
}

function hash() {
  return z.string().regex(/^[0-9a-fA-F]{64}$/);
}

function transactionSchema() {
  const owners = z.array(z.string()).nullish();
  return z.looseObject({
    hash: hash(),
    block_height: z.number().int(),
    fees: amount(),
    confirmed: z.string().optional(),
    double_spend: z.boolean().optional(),
    next_inputs: z.string().optional(),
    next_outputs: z.string().optional(),
    inputs: z.array(z.looseObject({ addresses: owners, witness: z.array(z.string()).optional() })),
    outputs: z.array(
      z.looseObject({ addresses: owners, script: z.string().optional(), value: amount() }),
    ),
  });
}

interface BlockCypherEndpoint {
  readonly addresses?: readonly string[] | null;
}

interface BlockCypherInput extends BlockCypherEndpoint {
  readonly witness?: readonly string[];
}

interface BlockCypherOutput extends BlockCypherEndpoint {
  readonly script?: string;
  readonly value: bigint;
}

interface BlockCypherTransaction {
  readonly hash: string;
  readonly block_height: number;
  readonly fees: bigint;
  readonly confirmed?: string;
  readonly double_spend?: boolean;
  readonly next_inputs?: string;
  readonly next_outputs?: string;
  readonly inputs: readonly BlockCypherInput[];
  readonly outputs: readonly BlockCypherOutput[];
}

interface HistoryRow {
  readonly tx: BlockCypherTransaction;
  readonly raw: unknown;
}

interface Transfer {
  readonly from: string;
  readonly to: string | null;
  readonly value: bigint;
}

/* ISO with millis like the other providers, or nothing when BlockCypher's time doesn't parse. */
function isoTime(value: string | undefined): string | undefined {
  const date = new Date(value ?? Number.NaN);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function ownerOf(endpoint: BlockCypherEndpoint): string | undefined {
  return endpoint.addresses?.[0];
}

function sum(outputs: readonly BlockCypherOutput[]): bigint {
  return outputs.reduce((total, output) => total + output.value, 0n);
}

/* An OP_RETURN output names nobody, so it never becomes the recipient. */
function payments(tx: BlockCypherTransaction): readonly BlockCypherOutput[] {
  return tx.outputs.filter((output) => ownerOf(output) !== undefined);
}

function senderOf(tx: BlockCypherTransaction): string {
  return tx.inputs.map(ownerOf).find((owner) => owner !== undefined) ?? "";
}

/* From an address, a send is worth what went to everyone else and a receive what landed on it. */
function transfer(tx: BlockCypherTransaction, address: string | undefined): Transfer {
  if (address === undefined) {
    const first = payments(tx)[0];
    return {
      from: senderOf(tx),
      to: first ? (ownerOf(first) ?? null) : null,
      value: first?.value ?? 0n,
    };
  }
  const touches = (endpoint: BlockCypherEndpoint) => endpoint.addresses?.includes(address) === true;
  if (tx.inputs.some(touches)) {
    const others = payments(tx).filter((output) => !touches(output));
    return { from: address, to: ownerOf(others[0] ?? {}) ?? address, value: sum(others) };
  }
  return { from: senderOf(tx), to: address, value: sum(tx.outputs.filter(touches)) };
}

/* A `next_inputs` or `next_outputs` link means the lists stop early, and half a list miscounts. */
function assertWhole(tx: BlockCypherTransaction): void {
  if (tx.next_inputs !== undefined || tx.next_outputs !== undefined)
    throw new ExplorerError(
      `BlockCypher cut transaction ${tx.hash} short at ${IO_LIMIT} inputs or outputs`,
      BlockCypher.key,
    );
}

/* A mempool row sits at height -1, and one that lost a double spend never confirms. */
function statusOf(tx: BlockCypherTransaction): Transaction["status"] {
  if (tx.block_height >= 0) return "success";
  return tx.double_spend === true ? "failed" : "pending";
}

/* `raw` is the record as BlockCypher sent it, since the parsed one holds bigints JSON refuses. */
function mapTransaction(record: HistoryRow, address?: string): Transaction {
  const { tx } = record;
  assertWhole(tx);
  const { from, to, value } = transfer(tx, address);
  const confirmed = tx.block_height >= 0;
  return {
    hash: tx.hash,
    blockNumber: confirmed ? tx.block_height : 0,
    ...(confirmed && tx.confirmed !== undefined ? { timestamp: isoTime(tx.confirmed) } : {}),
    from,
    to,
    value: value.toString(),
    valueFormatted: formatWei(value, DECIMALS),
    fee: tx.fees.toString(),
    status: statusOf(tx),
    isContractInteraction: false,
    tokenTransfers: [],
    opReturn: collectOpReturns(tx.outputs.map((output) => output.script)),
    inscriptions: collectInscriptions(tx.inputs.map((input) => input.witness)),
    raw: record.raw as Record<string, unknown>,
  };
}

function wholeHeight(value: number | undefined): boolean {
  return value === undefined || (Number.isSafeInteger(value) && value >= 0);
}

function assertHistoryOptions(options: Readonly<TxHistoryOptions>): void {
  if (options.sort === "asc")
    throw new ExplorerError("BlockCypher lists history newest first only", BlockCypher.key);
  const { startBlock, endBlock } = options;
  if (
    !wholeHeight(startBlock) ||
    !wholeHeight(endBlock) ||
    (startBlock ?? 0) > (endBlock ?? Infinity)
  )
    throw new ExplorerError(
      "BlockCypher history needs whole block heights from 0 and startBlock <= endBlock",
      BlockCypher.key,
    );
}

/* BlockCypher's `after` and `before` are exclusive, so inclusive bounds move one block out. */
function heightWindow(options: Readonly<TxHistoryOptions>): { after?: number; before?: number } {
  assertHistoryOptions(options);
  const { startBlock, endBlock } = options;
  return {
    after: startBlock === undefined || startBlock === 0 ? undefined : startBlock - 1,
    before: endBlock === undefined ? undefined : endBlock + 1,
  };
}

/* The lowest confirmed height on a page, where the next page starts below. */
function nextCursor(heights: readonly number[]): number | undefined {
  const confirmed = heights.filter((height) => height >= 0);
  return confirmed.length === 0 ? undefined : Math.min(...confirmed);
}

function addressPageSchema() {
  return z.looseObject({ txs: z.array(z.unknown()).optional() });
}

function txrefSchema() {
  return z.looseObject({
    tx_hash: hash(),
    tx_output_n: z.number().int().nonnegative(),
    value: amount(),
    block_height: z.number().int().optional(),
    confirmed: z.string().optional(),
  });
}

interface BlockCypherTxref {
  readonly tx_hash: string;
  readonly tx_output_n: number;
  readonly value: bigint;
  readonly block_height?: number;
  readonly confirmed?: string;
}

/* A mempool output carries no height at all, not even the -1 transactions use. */
function heightOf(ref: BlockCypherTxref): number {
  return ref.block_height ?? -1;
}

function mapUtxo(ref: BlockCypherTxref): Utxo {
  const height = heightOf(ref);
  const confirmed = height >= 0;
  return {
    txid: ref.tx_hash,
    vout: ref.tx_output_n,
    value: ref.value.toString(),
    valueFormatted: formatWei(ref.value, DECIMALS),
    confirmed,
    blockNumber: confirmed ? height : null,
    blockHash: null,
    ...(confirmed && ref.confirmed !== undefined ? { timestamp: isoTime(ref.confirmed) } : {}),
  };
}

export class BlockCypher extends Provider {
  static readonly key = "blockcypher";

  private readonly baseUrl: string;
  private readonly defaultChain: ChainKey;

  constructor(config: Readonly<ProviderConfig> = {}) {
    super(config);
    this.baseUrl = normalizeBaseUrl(config.baseUrl ?? DEFAULT_BASE);
    this.defaultChain = config.defaultChain ?? "bitcoin";
  }

  /* Outputs name the spend's txid without its input or block, and fees come per kilobyte. */
  get capabilities(): ProviderCapabilities {
    return {
      balances: true,
      txHistory: true,
      txDetail: true,
      utxos: true,
      pubkeys: false,
      contractInfo: false,
      tokenBalances: false,
      tokenTransfers: false,
      gasData: false,
      blockInfo: true,
    };
  }

  /* BlockCypher answers a missing object with 404 and `{"error": "… not found."}`. */
  private async read(
    chain: ChainKey,
    request: Readonly<{ path: string; resource: string }>,
  ): Promise<unknown> {
    try {
      return await this.getJSON<unknown>(`${this.baseUrl}/${networkOf(chain)}${request.path}`);
    } catch (error) {
      if (error instanceof NotFoundError)
        throw new NotFoundError(request.resource, BlockCypher.key);
      throw error;
    }
  }

  /* `balance` is confirmed, and `unconfirmed_balance` is the signed mempool change on top of it. */
  async getBalance(address: string, chain: ChainKey = this.defaultChain): Promise<Balance> {
    const feed = feedAddress(address, chain);
    const parsed = z
      .looseObject({
        balance: amount(),
        unconfirmed_balance: amount(),
        total_received: amount(),
        total_sent: amount(),
      })
      .safeParse(
        await this.read(chain, {
          path: `/addrs/${encodeURIComponent(feed)}/balance`,
          resource: `Address ${address}`,
        }),
      );
    if (!parsed.success)
      throw new ExplorerError("Unexpected BlockCypher balance response", BlockCypher.key);
    const { balance, unconfirmed_balance, total_received, total_sent } = parsed.data;
    return this.snapshotBalance({
      address,
      chain,
      balance: balance.toString(),
      balanceFormatted: formatWei(balance, DECIMALS),
      funded: total_received.toString(),
      spent: total_sent.toString(),
      unconfirmed: unconfirmed_balance.toString(),
      symbol: getChain(chain).symbol,
    });
  }

  /* Four reads at most, so an address whose sweeps fill pages can answer short of `limit`. */
  async getTxHistory(
    address: string,
    chain: ChainKey = this.defaultChain,
    options: Readonly<TxHistoryOptions> = {},
  ): Promise<Transaction[]> {
    const feed = feedAddress(address, chain);
    const window = heightWindow(options);
    const { limit, offset } = historyPage(
      options,
      HISTORY_PAGE * HISTORY_READS,
      BlockCypher.key,
      HISTORY_PAGE,
    );
    const { rows, complete } = await this.historyRows(chain, {
      feed,
      ...window,
      wanted: offset + limit,
    });
    if (!complete && rows.length <= offset)
      throw new ExplorerError(
        `BlockCypher history stops after ${rows.length} of the newest transactions, short of page ${options.page ?? 1}`,
        BlockCypher.key,
      );
    return rows.slice(offset, offset + limit).map((row) => mapTransaction(row, feed));
  }

  private async historyRows(
    chain: ChainKey,
    walk: Readonly<{ feed: string; after?: number; before?: number; wanted: number }>,
  ): Promise<{ rows: HistoryRow[]; complete: boolean }> {
    const rows: HistoryRow[] = [];
    let before = walk.before;
    for (let read = 0; read < HISTORY_READS; read += 1) {
      const page = await this.historyPage(chain, {
        ...walk,
        before,
        limit: walk.wanted - rows.length,
      });
      rows.push(...page);
      if (rows.length >= walk.wanted || page.length === 0) return { rows, complete: true };
      before = nextCursor(page.map((row) => row.tx.block_height));
      if (before === undefined) return { rows, complete: false };
    }
    return { rows, complete: false };
  }

  private async historyPage(
    chain: ChainKey,
    page: Readonly<{ feed: string; after?: number; before?: number; limit: number }>,
  ): Promise<HistoryRow[]> {
    const query = buildQuery({
      limit: Math.min(page.limit, HISTORY_PAGE),
      txlimit: IO_LIMIT,
      after: page.after,
      before: page.before,
    });
    const response = addressPageSchema().safeParse(
      await this.read(chain, {
        path: `/addrs/${encodeURIComponent(page.feed)}/full${query}`,
        resource: `Address ${page.feed}`,
      }),
    );
    const records = response.success ? (response.data.txs ?? []) : undefined;
    const parsed = z.array(transactionSchema()).safeParse(records);
    if (records === undefined || !parsed.success)
      throw new ExplorerError("Unexpected BlockCypher history response", BlockCypher.key);
    return parsed.data.map((tx, index) => ({ tx, raw: records[index] }));
  }

  override async getTxDetail(
    hash: string,
    chain: ChainKey = this.defaultChain,
  ): Promise<Transaction> {
    networkOf(chain);
    assertTxid(hash);
    const response = await this.read(chain, {
      path: `/txs/${hash.toLowerCase()}${buildQuery({ limit: IO_LIMIT })}`,
      resource: `Transaction ${hash}`,
    });
    const parsed = transactionSchema().safeParse(response);
    if (!parsed.success)
      throw new ExplorerError("Unexpected BlockCypher transaction response", BlockCypher.key);
    return mapTransaction({ tx: parsed.data, raw: response });
  }

  /* Pages of 2000 outputs, three at most, newest block first; mempool outputs lead the first. */
  override async getUtxos(address: string, chain: ChainKey = this.defaultChain): Promise<Utxo[]> {
    const feed = feedAddress(address, chain);
    const pageSchema = z.looseObject({
      txrefs: z.array(txrefSchema()).optional(),
      unconfirmed_txrefs: z.array(txrefSchema()).optional(),
      hasMore: z.boolean().optional(),
    });
    const utxos: Utxo[] = [];
    let before: number | undefined;
    for (let read = 0; read < UTXO_READS; read += 1) {
      const parsed = pageSchema.safeParse(
        await this.read(chain, {
          path: `/addrs/${encodeURIComponent(feed)}${buildQuery({ unspentOnly: "true", limit: UTXO_PAGE, before })}`,
          resource: `Address ${address}`,
        }),
      );
      if (!parsed.success)
        throw new ExplorerError("Unexpected BlockCypher unspent response", BlockCypher.key);
      const refs = [
        ...(read === 0 ? (parsed.data.unconfirmed_txrefs ?? []) : []),
        ...(parsed.data.txrefs ?? []),
      ];
      utxos.push(...refs.map(mapUtxo));
      before = nextCursor(refs.map(heightOf));
      if (parsed.data.hasMore !== true || before === undefined) return utxos;
    }
    throw new ExplorerError(
      `BlockCypher lists at most ${UTXO_PAGE * UTXO_READS} unspent outputs per address`,
      BlockCypher.key,
    );
  }

  /* `limit=1` keeps the txid list short; the count comes from `n_tx`. */
  override async getBlockInfo(
    blockNumber: number,
    chain: ChainKey = this.defaultChain,
  ): Promise<BlockInfo> {
    networkOf(chain);
    if (!Number.isSafeInteger(blockNumber) || blockNumber < 0)
      throw new ExplorerError("Invalid block height", BlockCypher.key);
    const parsed = z
      .looseObject({
        hash: hash(),
        height: z.number().int().nonnegative(),
        prev_block: z.string(),
        time: z.string(),
        n_tx: z.number().int().nonnegative(),
        ver: z.number().int(),
        mrkl_root: z.string(),
        bits: z.number().int(),
        nonce: z.number().int(),
        size: z.number().int().optional(),
      })
      .safeParse(
        await this.read(chain, {
          path: `/blocks/${blockNumber}${buildQuery({ limit: 1 })}`,
          resource: `Block ${blockNumber}`,
        }),
      );
    if (!parsed.success)
      throw new ExplorerError("Unexpected BlockCypher block response", BlockCypher.key);
    const block = parsed.data;
    if (block.height !== blockNumber)
      throw new NotFoundError(`Block ${blockNumber}`, BlockCypher.key);
    return {
      number: block.height,
      hash: block.hash,
      parentHash: block.prev_block,
      timestamp: isoTime(block.time) ?? block.time,
      miner: "",
      txCount: block.n_tx,
      version: block.ver,
      merkleRoot: block.mrkl_root,
      bits: block.bits,
      nonce: block.nonce,
      size: block.size,
    };
  }
}
