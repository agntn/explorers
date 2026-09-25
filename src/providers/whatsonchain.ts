/**
 * WhatsOnChain provider for Bitcoin SV.
 *
 * Keyless up to 3 requests per second; `WHATSONCHAIN_API_KEY` travels in the `Authorization`
 * header for a paid plan. `baseUrl` is the network root, `https://api.whatsonchain.com/v1/bsv/main`
 * by default.
 *
 * WhatsOnChain names an input only by the output it spends, so the sender, the fee and whether an
 * address paid into a transaction all come from the parent transactions, read in batches of 20.
 *
 * https://docs.whatsonchain.com
 */

import { getChain } from "@agntn/chains";
import { z } from "zod";
import { Provider } from "../core/provider.ts";
import { buildQuery, normalizeBaseUrl } from "../core/client.ts";
import { ExplorerError, NotFoundError, UnsupportedChainError } from "../core/errors.ts";
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

const DEFAULT_BASE = "https://api.whatsonchain.com/v1/bsv/main";

const DECIMALS = 8;

/** Most transactions `POST /txs` answers for in one request. */
const TX_BATCH = 20;

/** Parent batches one read may spend on resolving inputs, 200 parents in all. */
const PARENT_BATCHES = 10;

/** Deepest history page, reached by walking the `next-page` tokens one request at a time. */
const MAX_PAGE = 10;

/** Pages of unspent outputs, a thousand confirmed ones each, read before the list stops. */
const UTXO_PAGES = 10;

function assertChain(chain: ChainKey): void {
  if (chain !== "bitcoinsv") throw new UnsupportedChainError(chain, WhatsOnChain.key);
}

function assertAddress(address: string): void {
  try {
    getChain("bitcoinsv").assertAddress(address);
  } catch {
    throw new ExplorerError("Invalid Bitcoin SV address", WhatsOnChain.key);
  }
}

function assertTxid(hash: string): void {
  if (!/^[0-9a-fA-F]{64}$/.test(hash))
    throw new ExplorerError("Invalid Bitcoin SV transaction hash", WhatsOnChain.key);
}

/*
 * Convert a BSV amount to satoshis without multiplying floats. WhatsOnChain prints outputs as JSON
 * numbers in BSV, and `String()` spells the small ones in exponent form (`1e-8` for one satoshi).
 */
function toSatoshis(value: number): bigint {
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(String(value));
  if (!match || value > 21_000_000) throw new ExplorerError("Invalid BSV amount", WhatsOnChain.key);
  const fraction = match[2] ?? "";
  const shift = DECIMALS + Number(match[3] ?? 0) - fraction.length;
  if (shift < -16 || shift > 16) throw new ExplorerError("Invalid BSV amount", WhatsOnChain.key);
  const digits = BigInt(`${match[1]}${fraction}`);
  if (shift >= 0) return digits * 10n ** BigInt(shift);
  const divisor = 10n ** BigInt(-shift);
  if (digits % divisor !== 0n)
    throw new ExplorerError("Fractional satoshi in BSV amount", WhatsOnChain.key);
  return digits / divisor;
}

function formatSatoshis(satoshis: bigint): string {
  return formatWei(satoshis.toString(), DECIMALS);
}

function satoshiSchema() {
  return z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)]);
}

function outputSchema() {
  return z.looseObject({
    value: z.number().nonnegative(),
    n: z.number().int().nonnegative(),
    scriptPubKey: z.looseObject({
      hex: z.string().optional(),
      type: z.string().optional(),
      addresses: z.array(z.string()).nullish(),
    }),
  });
}

function transactionSchema() {
  return z.looseObject({
    txid: z.string().regex(/^[0-9a-fA-F]{64}$/),
    vin: z.array(
      z.looseObject({
        coinbase: z.string().optional(),
        txid: z.string(),
        vout: z.number().int().nonnegative(),
      }),
    ),
    vout: z.array(outputSchema()),
    confirmations: z.number().int().optional(),
    blockheight: z.number().int().nonnegative().optional(),
    blocktime: z.number().int().nonnegative().optional(),
    time: z.number().int().nonnegative().optional(),
  });
}

interface WocOutput {
  readonly value: number;
  readonly n: number;
  readonly scriptPubKey: {
    readonly hex?: string;
    readonly type?: string;
    readonly addresses?: readonly string[] | null;
  };
}

interface WocTransaction {
  readonly txid: string;
  readonly vin: readonly {
    readonly coinbase?: string;
    readonly txid: string;
    readonly vout: number;
  }[];
  readonly vout: readonly WocOutput[];
  readonly confirmations?: number;
  readonly blockheight?: number;
  readonly blocktime?: number;
  readonly time?: number;
}

function parseTransactions(raw: unknown): WocTransaction[] {
  const parsed = z.array(transactionSchema()).safeParse(raw);
  if (!parsed.success)
    throw new ExplorerError("Unexpected WhatsOnChain transaction response", WhatsOnChain.key);
  return parsed.data;
}

/* Several endpoints answer 200 with the reason in an `error` field. */
function assertNoError(error: string | undefined): void {
  if (error) throw new ExplorerError(`WhatsOnChain: ${error}`, WhatsOnChain.key);
}

function outputAddress(output?: WocOutput): string | undefined {
  return output?.scriptPubKey.addresses?.[0];
}

/* A data carrier: bare OP_RETURN or the OP_FALSE OP_RETURN that Bitcoin SV uses since Genesis. */
function isDataOutput(output: WocOutput): boolean {
  const hex = output.scriptPubKey.hex?.toLowerCase() ?? "";
  return output.scriptPubKey.type === "nulldata" || hex.startsWith("6a") || hex.startsWith("006a");
}

function paysAddress(output: WocOutput | undefined, address: string): boolean {
  return Boolean(output?.scriptPubKey.addresses?.includes(address));
}

/* Transactions by txid. A record rather than a Map so it passes as a readonly parameter. */
type Known = Readonly<Record<string, WocTransaction>>;

/* Input txids come from the response, so `constructor` must not answer from the prototype. */
function lookup(known: Known, txid: string): WocTransaction | undefined {
  return Object.hasOwn(known, txid) ? known[txid] : undefined;
}

function isCoinbase(tx: WocTransaction): boolean {
  return Boolean(tx.vin[0]?.coinbase);
}

/* Outputs this transaction spends, `undefined` where the parent stayed unresolved. */
function spentOutputs(tx: WocTransaction, parents: Known): (WocOutput | undefined)[] {
  if (isCoinbase(tx)) return [];
  return tx.vin.map((input) =>
    lookup(parents, input.txid)?.vout.find((output) => output.n === input.vout),
  );
}

function sum(outputs: readonly WocOutput[]): bigint {
  return outputs.reduce((total, output) => total + toSatoshis(output.value), 0n);
}

function transactionFee(
  tx: WocTransaction,
  spent: readonly (WocOutput | undefined)[],
): string | undefined {
  if (isCoinbase(tx)) return "0";
  if (spent.some((output) => output === undefined)) return undefined;
  return (sum(spent as WocOutput[]) - sum(tx.vout)).toString();
}

function transactionPosition(tx: WocTransaction) {
  const confirmed = (tx.confirmations ?? 0) > 0;
  const time = tx.blocktime ?? tx.time;
  return {
    blockNumber: confirmed ? (tx.blockheight ?? 0) : 0,
    status: confirmed ? "success" : "pending",
    ...(time ? { timestamp: toTimestamp(time) } : {}),
  } as const;
}

/*
 * Pair a transaction with one transfer. Seen from an address, it is a send when one of its inputs
 * spent that address's output, and the value is what went to everyone else; otherwise it is what
 * the address received. Without an address, the first output that pays anyone carries the value.
 */
function transfer(
  tx: WocTransaction,
  spent: readonly (WocOutput | undefined)[],
  address?: string,
): { readonly from: string; readonly to: string | null; readonly value: bigint } {
  const sender = outputAddress(spent[0]) ?? "";
  const payments = tx.vout.filter((output) => !isDataOutput(output) && outputAddress(output));

  if (address === undefined) {
    const first = payments[0];
    return {
      from: sender,
      to: outputAddress(first) ?? null,
      value: first ? toSatoshis(first.value) : 0n,
    };
  }

  if (spent.some((output) => paysAddress(output, address))) {
    const others = payments.filter((output) => !paysAddress(output, address));
    return { from: address, to: outputAddress(others[0]) ?? address, value: sum(others) };
  }

  return {
    from: sender,
    to: address,
    value: sum(tx.vout.filter((output) => paysAddress(output, address))),
  };
}

function mapTransaction(tx: WocTransaction, parents: Known, address?: string): Transaction {
  const spent = spentOutputs(tx, parents);
  const fee = transactionFee(tx, spent);
  const { from, to, value } = transfer(tx, spent, address);
  return {
    hash: tx.txid,
    ...transactionPosition(tx),
    from,
    to,
    value: value.toString(),
    valueFormatted: formatSatoshis(value),
    ...(fee === undefined ? {} : { fee }),
    isContractInteraction: false,
    tokenTransfers: [],
    raw: tx as unknown as Record<string, unknown>,
  };
}

/* Parents of these transactions in input order, skipping coinbase inputs and known ones. */
function missingParents(txs: readonly WocTransaction[], known: Known): string[] {
  const ids = new Set<string>();
  for (const tx of txs) {
    if (isCoinbase(tx)) continue;
    for (const input of tx.vin) if (!lookup(known, input.txid)) ids.add(input.txid);
  }
  return [...ids];
}

function historyPage(page = 1): number {
  if (!Number.isInteger(page) || page < 1 || page > MAX_PAGE)
    throw new ExplorerError(`WhatsOnChain history reaches page ${MAX_PAGE}`, WhatsOnChain.key);
  return page;
}

function historyWindow(options: Readonly<TxHistoryOptions> = {}) {
  if (options.startBlock !== undefined || options.endBlock !== undefined)
    throw new ExplorerError("WhatsOnChain history takes no block bounds", WhatsOnChain.key);
  return {
    limit: clampMaxResults(options.limit),
    page: historyPage(options.page),
    order: options.sort ?? "desc",
  } as const;
}

interface WocUnspent {
  readonly tx_hash: string;
  readonly tx_pos: number;
  readonly value: number | string;
  readonly height: number;
  readonly isSpentInMempoolTx?: boolean;
  readonly status?: string;
}

/* An output some mempool transaction already spends is no longer the address's to spend. */
function mapUtxo(output: WocUnspent): Utxo | undefined {
  if (output.isSpentInMempoolTx) return undefined;
  const confirmed = output.status !== "unconfirmed" && output.height > 0;
  const value = String(output.value);
  return {
    txid: output.tx_hash,
    vout: output.tx_pos,
    value,
    valueFormatted: formatWei(value, DECIMALS),
    confirmed,
    blockNumber: confirmed ? output.height : null,
    blockHash: null,
  };
}

export class WhatsOnChain extends Provider {
  static readonly key = "whatsonchain";

  private readonly baseUrl: string;
  private readonly headers: Readonly<Record<string, string>>;

  constructor(config: Readonly<ProviderConfig> = {}) {
    super(config);
    this.baseUrl = normalizeBaseUrl(config.baseUrl ?? DEFAULT_BASE);
    const apiKey = config.apiKey ?? process.env.WHATSONCHAIN_API_KEY;
    this.headers = apiKey ? { Authorization: apiKey } : {};
  }

  /* `/feerecommendation` quotes satoshis per kilobyte, a unit no other provider here speaks, so
     gas stays unsupported rather than converted into something that looks like `sat/vB`. */
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

  private get<T>(path: string): Promise<T> {
    return this.getJSON<T>(`${this.baseUrl}${path}`, { headers: this.headers });
  }

  private async transactions(txids: readonly string[]): Promise<WocTransaction[]> {
    const found: WocTransaction[] = [];
    for (let start = 0; start < txids.length; start += TX_BATCH) {
      const raw = await this.postJSON<unknown>(
        `${this.baseUrl}/txs`,
        { txids: txids.slice(start, start + TX_BATCH) },
        { headers: this.headers },
      );
      found.push(...parseTransactions(raw));
    }
    return found;
  }

  /* Read the parents these inputs spend, the first 200 of them, so a consolidation of thousands of
     inputs costs ten requests rather than hundreds. Past that the fee stays unknown. */
  private async parents(txs: readonly WocTransaction[]): Promise<Known> {
    const known: Record<string, WocTransaction> = Object.fromEntries(
      txs.map((tx) => [tx.txid, tx]),
    );
    const missing = missingParents(txs, known).slice(0, PARENT_BATCHES * TX_BATCH);
    for (const parent of await this.transactions(missing)) known[parent.txid] = parent;
    return known;
  }

  async getBalance(address: string, chain: ChainKey = "bitcoinsv"): Promise<Balance> {
    assertChain(chain);
    assertAddress(address);
    const path = `/address/${encodeURIComponent(address)}`;
    const [confirmedRaw, unconfirmedRaw] = await Promise.all([
      this.get<unknown>(`${path}/confirmed/balance`),
      this.get<unknown>(`${path}/unconfirmed/balance`),
    ]);
    const confirmed = z
      .looseObject({ confirmed: satoshiSchema(), error: z.string().optional() })
      .safeParse(confirmedRaw);
    const unconfirmed = z
      .looseObject({
        unconfirmed: z.union([z.number().int(), z.string().regex(/^-?\d+$/)]),
        error: z.string().optional(),
      })
      .safeParse(unconfirmedRaw);
    if (!confirmed.success || !unconfirmed.success)
      throw new ExplorerError("Unexpected WhatsOnChain balance response", WhatsOnChain.key);
    assertNoError(confirmed.data.error);
    assertNoError(unconfirmed.data.error);

    const balance = BigInt(confirmed.data.confirmed);
    return this.snapshotBalance({
      address,
      chain,
      balance: balance.toString(),
      balanceFormatted: formatSatoshis(balance),
      unconfirmed: BigInt(unconfirmed.data.unconfirmed).toString(),
      symbol: "BSV",
    });
  }

  async getTxHistory(
    address: string,
    chain: ChainKey = "bitcoinsv",
    options?: Readonly<TxHistoryOptions>,
  ): Promise<Transaction[]> {
    assertChain(chain);
    assertAddress(address);
    const { limit, page, order } = historyWindow(options);
    const pageSchema = z.looseObject({
      result: z.array(
        z.looseObject({
          tx_hash: z.string().regex(/^[0-9a-fA-F]{64}$/),
          height: z.number().int().nonnegative(),
        }),
      ),
      nextPageToken: z.string().optional(),
      error: z.string().optional(),
    });

    let token: string | undefined;
    let rows: z.infer<typeof pageSchema>["result"] = [];
    for (let current = 1; current <= page; current += 1) {
      if (current > 1 && token === undefined) return [];
      const parsed = pageSchema.safeParse(
        await this.get<unknown>(
          `/address/${encodeURIComponent(address)}/confirmed/history${buildQuery({ limit, order, token })}`,
        ),
      );
      if (!parsed.success)
        throw new ExplorerError("Unexpected WhatsOnChain history response", WhatsOnChain.key);
      assertNoError(parsed.data.error);
      rows = parsed.data.result;
      token = parsed.data.nextPageToken || undefined;
    }

    // A page holds the requested end of the history but lists it the other way round.
    const ordered = rows.toSorted((a, b) =>
      order === "asc" ? a.height - b.height : b.height - a.height,
    );
    const txs = await this.transactions(ordered.map((row) => row.tx_hash));
    const byHash = new Map(txs.map((tx) => [tx.txid, tx]));
    const parents = await this.parents(txs);
    return ordered.flatMap((row) => {
      const tx = byHash.get(row.tx_hash);
      return tx ? [mapTransaction(tx, parents, address)] : [];
    });
  }

  override async getTxDetail(hash: string, chain: ChainKey = "bitcoinsv"): Promise<Transaction> {
    assertChain(chain);
    assertTxid(hash);
    const parsed = transactionSchema().safeParse(
      await this.get<unknown>(`/tx/hash/${encodeURIComponent(hash)}`),
    );
    if (!parsed.success)
      throw new ExplorerError("Unexpected WhatsOnChain transaction response", WhatsOnChain.key);
    return mapTransaction(parsed.data, await this.parents([parsed.data]));
  }

  override async getUtxos(address: string, chain: ChainKey = "bitcoinsv"): Promise<Utxo[]> {
    assertChain(chain);
    assertAddress(address);
    const pageSchema = z.looseObject({
      result: z.array(
        z.looseObject({
          tx_hash: z.string().regex(/^[0-9a-fA-F]{64}$/),
          tx_pos: z.number().int().nonnegative(),
          value: satoshiSchema(),
          height: z.number().int().nonnegative(),
          isSpentInMempoolTx: z.boolean().optional(),
          status: z.string().optional(),
        }),
      ),
      nextPageToken: z.string().optional(),
      error: z.string().optional(),
    });

    const utxos: Utxo[] = [];
    let token: string | undefined;
    for (let page = 0; page < UTXO_PAGES; page += 1) {
      const parsed = pageSchema.safeParse(
        await this.get<unknown>(
          `/address/${encodeURIComponent(address)}/unspent/all${buildQuery({ token })}`,
        ),
      );
      if (!parsed.success)
        throw new ExplorerError("Unexpected WhatsOnChain unspent response", WhatsOnChain.key);
      assertNoError(parsed.data.error);
      utxos.push(...parsed.data.result.flatMap((output) => mapUtxo(output) ?? []));
      token = parsed.data.nextPageToken || undefined;
      if (token === undefined) break;
    }
    return utxos;
  }

  override async getBlockInfo(
    blockNumber: number,
    chain: ChainKey = "bitcoinsv",
  ): Promise<BlockInfo> {
    assertChain(chain);
    if (!Number.isSafeInteger(blockNumber) || blockNumber < 0)
      throw new ExplorerError("Invalid Bitcoin SV block height", WhatsOnChain.key);
    const parsed = z
      .looseObject({
        hash: z.string().regex(/^[0-9a-fA-F]{64}$/),
        height: z.number().int().nonnegative(),
        time: z.number().int().nonnegative(),
        txcount: z.number().int().nonnegative(),
        previousblockhash: z.string().optional(),
      })
      .safeParse(await this.get<unknown>(`/block/height/${blockNumber}`));
    if (!parsed.success)
      throw new ExplorerError("Unexpected WhatsOnChain block response", WhatsOnChain.key);
    const block = parsed.data;
    if (block.height !== blockNumber)
      throw new NotFoundError(`Block ${blockNumber}`, WhatsOnChain.key);
    return {
      number: block.height,
      hash: block.hash,
      parentHash: block.previousblockhash ?? "",
      timestamp: toTimestamp(block.time),
      miner: "",
      gasUsed: "0",
      gasLimit: "0",
      txCount: block.txcount,
    };
  }
}
