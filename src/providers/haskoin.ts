/**
 * Haskoin Store provider, the indexer behind api.haskoin.com, serving Bitcoin Cash.
 *
 * Keyless. `baseUrl` is the network root, `https://api.haskoin.com/bch` by default. Every input
 * names the address and value it spends, so the sender, the fee and the side an address stands on
 * come from one transaction read, without parent lookups. Addresses come back as prefixed CashAddr.
 *
 * https://github.com/jprupp/haskoin-store/blob/master/swagger.yaml
 */

import { getChain } from "@agntn/chains";
import { z } from "zod";
import { Provider } from "../core/provider.ts";
import { buildQuery, normalizeBaseUrl } from "../core/client.ts";
import { ExplorerError, HTTPError, NotFoundError, UnsupportedChainError } from "../core/errors.ts";
import { clampMaxResults, formatWei, toTimestamp } from "../core/types.ts";
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

const DEFAULT_BASE = "https://api.haskoin.com/bch";

const DECIMALS = 8;

/* The public instance refuses an `offset` above 50000 with a 400. */
const MAX_OFFSET = 50_000;

const UTXO_PAGE = 1000;

const UTXO_PAGES = 10;

function assertChain(chain: ChainKey): void {
  if (chain !== "bitcoincash") throw new UnsupportedChainError(chain, Haskoin.key);
}

/* Haskoin names every address as lowercase CashAddr with the `bitcoincash:` prefix, so the input
   takes the same spelling before it is compared with inputs and outputs. */
function cashAddress(address: string): string {
  try {
    getChain("bitcoincash").assertAddress(address);
  } catch {
    throw new ExplorerError("Invalid Bitcoin Cash address, expected CashAddr", Haskoin.key);
  }
  const lower = address.toLowerCase();
  return lower.startsWith("bitcoincash:") ? lower : `bitcoincash:${lower}`;
}

function assertTxid(hash: string): void {
  if (!/^[0-9a-fA-F]{64}$/.test(hash))
    throw new ExplorerError("Invalid Bitcoin Cash transaction hash", Haskoin.key);
}

/* Satoshi amounts arrive as JSON integers, and the HTTP client keeps one past 2^53 as a string. */
function amount() {
  return z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)]).transform(BigInt);
}

function hash() {
  return z.string().regex(/^[0-9a-fA-F]{64}$/);
}

/* A confirmed record names its block height; an unconfirmed one the time the mempool took it. */
function blockSchema() {
  return z
    .looseObject({
      height: z.number().int().nonnegative().optional(),
      mempool: z.number().int().nonnegative().optional(),
    })
    .refine((block) => (block.height === undefined) !== (block.mempool === undefined));
}

interface HaskoinBlock {
  readonly height?: number;
}

function heightOf(block: HaskoinBlock): number | null {
  return block.height ?? null;
}

function transactionSchema() {
  return z.looseObject({
    txid: hash(),
    fee: amount(),
    inputs: z.array(
      z.looseObject({
        coinbase: z.boolean(),
        address: z.string().nullish(),
        value: amount().nullish(),
      }),
    ),
    outputs: z.array(z.looseObject({ address: z.string().nullish(), value: amount() })),
    block: blockSchema(),
    deleted: z.boolean(),
    time: z.number().int().nonnegative(),
  });
}

interface HaskoinEndpoint {
  readonly address?: string | null;
}

interface HaskoinOutput extends HaskoinEndpoint {
  readonly value: bigint;
}

interface HaskoinTransaction {
  readonly txid: string;
  readonly fee: bigint;
  readonly inputs: readonly HaskoinEndpoint[];
  readonly outputs: readonly HaskoinOutput[];
  readonly block: HaskoinBlock;
  readonly deleted: boolean;
  readonly time: number;
}

interface Transfer {
  readonly from: string;
  readonly to: string | null;
  readonly value: bigint;
}

function sum(outputs: readonly HaskoinOutput[]): bigint {
  return outputs.reduce((total, output) => total + output.value, 0n);
}

/* An OP_RETURN output has no address and never becomes the recipient. */
function payments(tx: HaskoinTransaction): readonly HaskoinOutput[] {
  return tx.outputs.filter((output) => Boolean(output.address));
}

function senderOf(tx: HaskoinTransaction): string {
  return tx.inputs[0]?.address ?? "";
}

/* Without an address, the first output that pays anyone carries the value. */
function firstPayment(tx: HaskoinTransaction): Transfer {
  const first = payments(tx)[0];
  return { from: senderOf(tx), to: first?.address ?? null, value: first?.value ?? 0n };
}

/*
 * Seen from an address, a transaction is a send when one of its inputs spent from that address,
 * and the value is what went to everyone else; otherwise it is what the address received.
 */
function transfer(tx: HaskoinTransaction, address?: string): Transfer {
  if (address === undefined) return firstPayment(tx);
  const touches = (endpoint: HaskoinEndpoint) => endpoint.address === address;
  if (tx.inputs.some(touches)) {
    const others = payments(tx).filter((output) => !touches(output));
    return { from: address, to: others[0]?.address ?? address, value: sum(others) };
  }
  return { from: senderOf(tx), to: address, value: sum(tx.outputs.filter(touches)) };
}

/* A deleted transaction lost its place to a double spend or a reorganization. */
function mapTransaction(tx: HaskoinTransaction, address?: string): Transaction {
  const height = heightOf(tx.block);
  const { from, to, value } = transfer(tx, address);
  return {
    hash: tx.txid,
    blockNumber: height ?? 0,
    ...(height === null ? {} : { timestamp: toTimestamp(tx.time) }),
    from,
    to,
    value: value.toString(),
    valueFormatted: formatWei(value, DECIMALS),
    fee: tx.fee.toString(),
    status: tx.deleted ? "failed" : height === null ? "pending" : "success",
    isContractInteraction: false,
    tokenTransfers: [],
    raw: tx as unknown as Record<string, unknown>,
  };
}

function assertHistoryOrder(options: Readonly<TxHistoryOptions>): void {
  if (options.sort === "asc")
    throw new ExplorerError("Haskoin lists history newest first only", Haskoin.key);
  if (options.startBlock !== undefined)
    throw new ExplorerError("Haskoin history takes an end block only", Haskoin.key);
  const end = options.endBlock;
  if (end !== undefined && (!Number.isSafeInteger(end) || end < 0))
    throw new ExplorerError("Invalid Bitcoin Cash end block", Haskoin.key);
}

/* Haskoin lists newest first and bounds a listing from above only, through `height`. */
function historyWindow(options: Readonly<TxHistoryOptions> = {}) {
  assertHistoryOrder(options);
  const page = options.page ?? 1;
  if (!Number.isSafeInteger(page) || page < 1)
    throw new ExplorerError("Haskoin history pages start at 1", Haskoin.key);
  const limit = clampMaxResults(options.limit);
  const offset = (page - 1) * limit;
  if (offset > MAX_OFFSET)
    throw new ExplorerError(`Haskoin skips at most ${MAX_OFFSET} transactions`, Haskoin.key);
  return { limit, offset, height: options.endBlock };
}

/* The reason Haskoin gives in the `message` field of an error body. */
function errorReason(body: string | undefined): string | undefined {
  if (body === undefined) return undefined;
  try {
    const parsed = JSON.parse(body) as { message?: unknown } | null;
    const reason = parsed?.message;
    return typeof reason === "string" && reason !== "" ? reason : undefined;
  } catch {
    return undefined;
  }
}

export class Haskoin extends Provider {
  static readonly key = "haskoin";

  private readonly baseUrl: string;

  constructor(config: Readonly<ProviderConfig> = {}) {
    super(config);
    this.baseUrl = normalizeBaseUrl(config.baseUrl ?? DEFAULT_BASE);
  }

  /* Haskoin keeps no fee estimates, so gas stays unsupported. */
  get capabilities(): ProviderCapabilities {
    return {
      balances: true,
      txHistory: true,
      txDetail: true,
      utxos: true,
      contractInfo: false,
      tokenBalances: false,
      tokenTransfers: false,
      gasData: false,
      blockInfo: true,
    };
  }

  /* Haskoin answers a missing object with 404 and a rejected argument with 400, both with the
     reason in `message`, so a missing transaction names itself rather than the URL. */
  private async read(path: string, resource: string): Promise<unknown> {
    try {
      return await this.getJSON<unknown>(`${this.baseUrl}${path}`);
    } catch (error) {
      if (error instanceof NotFoundError) throw new NotFoundError(resource, Haskoin.key);
      if (!(error instanceof HTTPError) || error.statusCode !== 400) throw error;
      const reason = errorReason(error.body);
      if (reason === undefined) throw error;
      throw new ExplorerError(`Haskoin: ${reason}`, Haskoin.key);
    }
  }

  /*
   * `confirmed` sums the confirmed outputs nothing spends, the mempool included, and `unconfirmed`
   * the unspent outputs still in the mempool, so their sum is what the address holds once the
   * mempool confirms. A confirmed output a mempool transaction spends leaves `balance` at once.
   */
  async getBalance(address: string, chain: ChainKey = "bitcoincash"): Promise<Balance> {
    assertChain(chain);
    const parsed = z
      .looseObject({ confirmed: amount(), unconfirmed: amount(), received: amount() })
      .safeParse(
        await this.read(
          `/address/${encodeURIComponent(cashAddress(address))}/balance`,
          `Address ${address}`,
        ),
      );
    if (!parsed.success)
      throw new ExplorerError("Unexpected Haskoin balance response", Haskoin.key);
    const { confirmed, unconfirmed, received } = parsed.data;
    return this.snapshotBalance({
      address,
      chain,
      balance: confirmed.toString(),
      balanceFormatted: formatWei(confirmed, DECIMALS),
      funded: received.toString(),
      spent: (received - confirmed - unconfirmed).toString(),
      unconfirmed: unconfirmed.toString(),
      symbol: "BCH",
    });
  }

  async getTxHistory(
    address: string,
    chain: ChainKey = "bitcoincash",
    options?: Readonly<TxHistoryOptions>,
  ): Promise<Transaction[]> {
    assertChain(chain);
    const canonical = cashAddress(address);
    const window = historyWindow(options);
    const parsed = z
      .array(transactionSchema())
      .safeParse(
        await this.read(
          `/address/${encodeURIComponent(canonical)}/transactions/full${buildQuery(window)}`,
          `Address ${address}`,
        ),
      );
    if (!parsed.success)
      throw new ExplorerError("Unexpected Haskoin history response", Haskoin.key);
    return parsed.data.map((tx) => mapTransaction(tx, canonical));
  }

  override async getTxDetail(hash: string, chain: ChainKey = "bitcoincash"): Promise<Transaction> {
    assertChain(chain);
    assertTxid(hash);
    const parsed = transactionSchema().safeParse(
      await this.read(`/transaction/${hash.toLowerCase()}`, `Transaction ${hash}`),
    );
    if (!parsed.success)
      throw new ExplorerError("Unexpected Haskoin transaction response", Haskoin.key);
    return mapTransaction(parsed.data);
  }

  /* Pages of 1000 outputs, ten at most; an address holding more gets the newest 10000. */
  override async getUtxos(address: string, chain: ChainKey = "bitcoincash"): Promise<Utxo[]> {
    assertChain(chain);
    const canonical = cashAddress(address);
    const pageSchema = z.array(
      z.looseObject({
        txid: hash(),
        index: z.number().int().nonnegative(),
        value: amount(),
        block: blockSchema(),
      }),
    );

    const utxos: Utxo[] = [];
    for (let page = 0; page < UTXO_PAGES; page += 1) {
      const parsed = pageSchema.safeParse(
        await this.read(
          `/address/${encodeURIComponent(canonical)}/unspent${buildQuery({
            limit: UTXO_PAGE,
            offset: page * UTXO_PAGE,
          })}`,
          `Address ${address}`,
        ),
      );
      if (!parsed.success)
        throw new ExplorerError("Unexpected Haskoin unspent response", Haskoin.key);
      for (const output of parsed.data) {
        const height = heightOf(output.block);
        utxos.push({
          txid: output.txid,
          vout: output.index,
          value: output.value.toString(),
          valueFormatted: formatWei(output.value, DECIMALS),
          confirmed: height !== null,
          blockNumber: height,
          blockHash: null,
        });
      }
      if (parsed.data.length < UTXO_PAGE) break;
    }
    return utxos;
  }

  /* `/block/height/{height}` lists every block seen at that height, orphans included, and answers
     an empty list past the tip. The transaction count comes from the `tx` list, which `notx`
     would cut down to the coinbase. */
  override async getBlockInfo(
    blockNumber: number,
    chain: ChainKey = "bitcoincash",
  ): Promise<BlockInfo> {
    assertChain(chain);
    if (!Number.isSafeInteger(blockNumber) || blockNumber < 0)
      throw new ExplorerError("Invalid Bitcoin Cash block height", Haskoin.key);
    const parsed = z
      .array(
        z.looseObject({
          hash: hash(),
          height: z.number().int().nonnegative(),
          mainchain: z.boolean(),
          previous: z.string(),
          time: z.number().int().nonnegative(),
          tx: z.array(z.string()),
        }),
      )
      .safeParse(await this.read(`/block/height/${blockNumber}`, `Block ${blockNumber}`));
    if (!parsed.success) throw new ExplorerError("Unexpected Haskoin block response", Haskoin.key);
    const block = parsed.data.find((entry) => entry.mainchain && entry.height === blockNumber);
    if (block === undefined) throw new NotFoundError(`Block ${blockNumber}`, Haskoin.key);
    return {
      number: block.height,
      hash: block.hash,
      parentHash: block.previous,
      timestamp: toTimestamp(block.time),
      miner: "",
      gasUsed: "0",
      gasLimit: "0",
      txCount: block.tx.length,
    };
  }
}
