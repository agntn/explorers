/**
 * XRPSCAN provider: XRP Ledger accounts, payments, issued tokens and ledgers.
 *
 * The public API at api.xrpscan.com needs no key and allows 10,000 requests a day. It answers
 * history in pages of 25 behind a `marker`, ignores `limit`, and lists newest first only.
 *
 * https://docs.xrpscan.com/api-documentation/introduction
 */

import { getChain } from "@agntn/chains";
import { z } from "zod";
import { Provider } from "../core/provider.ts";
import { buildQuery, normalizeBaseUrl } from "../core/client.ts";
import { ExplorerError, NotFoundError, UnsupportedChainError } from "../core/errors.ts";
import { formatWei, historyPage } from "../core/types.ts";
import type {
  Balance,
  BlockInfo,
  ChainKey,
  ProviderCapabilities,
  ProviderConfig,
  TokenBalance,
  TokenBalanceOptions,
  TokenTransfer,
  Transaction,
  TxHistoryOptions,
} from "../core/types.ts";

const DEFAULT_BASE = "https://api.xrpscan.com/api/v1";
/** One XRP is a million drops. */
const XRP_DECIMALS = 6;
/** XRPSCAN pages hold 25 rows, so a history read reaches at most ten markers deep. */
const MAX_HISTORY_PAGES = 10;
const MAX_HISTORY_ROWS = 250;
/** The ledger's issued amounts keep exponents from -96 to 80, and past that it isn't an amount. */
const MAX_EXPONENT = 96;
/** `tfPartialPayment`: the sender accepts delivering less than `Amount`. */
const PARTIAL_PAYMENT = 0x0002_0000;

function assertChain(chain: ChainKey): void {
  if (chain !== "xrpl") throw new UnsupportedChainError(chain, XRPScan.key);
}

function assertAccount(address: string): void {
  try {
    getChain("xrpl").assertAddress(address);
  } catch {
    throw new ExplorerError("Invalid XRP Ledger address", XRPScan.key);
  }
}

function hashSchema() {
  return z.string().regex(/^[0-9a-fA-F]{64}$/);
}

/* Drops arrive as a JSON number, and the HTTP client keeps one past 2^53 a string. */
function dropsSchema() {
  return z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)]).transform(String);
}

function xrpAmountSchema() {
  return z.looseObject({ currency: z.literal("XRP"), value: dropsSchema() });
}

/* History prints issued values as text, a single transaction as a JSON number. */
function issuedValueSchema() {
  return z.union([z.string(), z.number().nonnegative()]).transform(String);
}

function issuedAmountSchema() {
  return z.looseObject({
    currency: z.string().min(3),
    issuer: z.string(),
    value: issuedValueSchema(),
  });
}

function timestampSchema() {
  return z.string().refine((value) => !Number.isNaN(Date.parse(value)));
}

function transactionSchema() {
  return z.looseObject({
    hash: hashSchema(),
    ledger_index: z.number().int().nonnegative(),
    date: timestampSchema(),
    TransactionType: z.string(),
    Account: z.string(),
    Destination: z.string().optional(),
    Fee: dropsSchema(),
    Flags: z.number().int().nonnegative().optional(),
    Amount: z.unknown().optional(),
    validated: z.boolean().optional(),
    meta: z
      .looseObject({ TransactionResult: z.string(), delivered_amount: z.unknown().optional() })
      .optional(),
  });
}

/** The transaction fields the rows read, whether from history or a single lookup. */
interface XRPScanTransaction {
  readonly [key: string]: unknown;
  readonly hash: string;
  readonly ledger_index: number;
  readonly date: string;
  readonly TransactionType: string;
  readonly Account: string;
  readonly Destination?: string;
  readonly Fee: string;
  readonly Flags?: number;
  readonly Amount?: unknown;
  readonly validated?: boolean;
  readonly meta?: Readonly<{ TransactionResult: string; delivered_amount?: unknown }>;
}

/** An issued amount as integer units plus the decimals that put the point back. */
interface IssuedUnits {
  readonly units: string;
  readonly decimals: number;
}

/**
 * Turn an issued-currency value into exact units. The ledger keeps these as decimal floats with
 * up to 16 significant digits and prints tiny or huge ones in exponent form, so each value gets
 * the decimals its own spelling needs.
 * @param {string} value - Positive decimal, optionally with an exponent, as the API prints it.
 * @returns {IssuedUnits | undefined} Exact units, or nothing for a value that isn't a decimal.
 */
function issuedUnits(value: string): IssuedUnits | undefined {
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(value);
  if (!match) return undefined;
  const fraction = match[2] ?? "";
  const exponent = Number(match[3] ?? "0");
  if (Math.abs(exponent) > MAX_EXPONENT) return undefined;
  const scale = fraction.length - exponent;
  let units = BigInt(`${match[1] ?? ""}${fraction}${"0".repeat(Math.max(0, -scale))}`).toString();
  let decimals = Math.max(0, scale);
  while (decimals > 0 && units !== "0" && units.endsWith("0")) {
    units = units.slice(0, -1);
    decimals -= 1;
  }
  return { units, decimals };
}

/**
 * A three-letter code stays as it is. A 40-hex code reads as its ASCII when every byte before
 * the zero padding is printable, the way XRPSCAN shows RLUSD for `524C5553440000…`.
 * @param {string} currency - Currency code from the ledger.
 * @returns {string} Readable symbol.
 */
function currencySymbol(currency: string): string {
  if (!/^[0-9A-F]{40}$/i.test(currency)) return currency;
  const bytes = currency.match(/../g) ?? [];
  const text = bytes
    .map((byte) => String.fromCodePoint(Number.parseInt(byte, 16)))
    .join("")
    .replace(/\0+$/, "");
  return /^[\x20-\x7E]+$/.test(text) ? text : currency;
}

/* A trust line token named the way XRPSCAN's token pages spell it, `CURRENCY.ISSUER`. */
function tokenId(currency: string, issuer: string): string {
  return `${currency}.${issuer}`;
}

/**
 * A failed payment or one from before 2014 has no usable `delivered_amount`, so `Amount` stands
 * in, unless the sender allowed a partial payment: then `Amount` is only a ceiling and nothing
 * says what arrived.
 * @param {XRPScanTransaction} tx - Parsed Payment.
 * @returns {unknown} The amount to read, or nothing when it can't be known.
 */
function paymentAmount(tx: XRPScanTransaction): unknown {
  const delivered = tx.meta?.delivered_amount;
  if (typeof delivered === "object" && delivered !== null) return delivered;
  return ((tx.Flags ?? 0) & PARTIAL_PAYMENT) === 0 ? tx.Amount : undefined;
}

function issuedTransfer(tx: XRPScanTransaction, amount: unknown): TokenTransfer[] {
  const issued = issuedAmountSchema().safeParse(amount);
  if (!issued.success) return [];
  const units = issuedUnits(issued.data.value);
  if (units === undefined) return [];
  return [
    {
      contract: tokenId(issued.data.currency, issued.data.issuer),
      symbol: currencySymbol(issued.data.currency),
      decimals: units.decimals,
      value: units.units,
      valueFormatted: formatWei(units.units, units.decimals),
      from: tx.Account,
      to: tx.Destination ?? "",
      txHash: tx.hash,
      blockNumber: tx.ledger_index,
      timestamp: new Date(tx.date).toISOString(),
    },
  ];
}

/**
 * Only a Payment moves value from `Account` to `Destination`, and only what the ledger delivered
 * counts: a partial payment's `Amount` is a ceiling, not the money that arrived.
 * @param {XRPScanTransaction} tx - Parsed transaction.
 * @returns {{ value: string; tokenTransfers: TokenTransfer[] }} XRP in drops, issued tokens apart.
 */
function payment(tx: XRPScanTransaction): { value: string; tokenTransfers: TokenTransfer[] } {
  if (tx.TransactionType !== "Payment") return { value: "0", tokenTransfers: [] };
  const amount = paymentAmount(tx);
  const xrp = z.union([xrpAmountSchema(), dropsSchema()]).safeParse(amount);
  if (xrp.success)
    return { value: typeof xrp.data === "string" ? xrp.data : xrp.data.value, tokenTransfers: [] };
  return { value: "0", tokenTransfers: issuedTransfer(tx, amount) };
}

function status(tx: XRPScanTransaction): Transaction["status"] {
  if (tx.validated === false) return "pending";
  return tx.meta?.TransactionResult === "tesSUCCESS" ? "success" : "failed";
}

function mapTransaction(tx: XRPScanTransaction, raw: unknown): Transaction {
  const { value, tokenTransfers } = payment(tx);
  const result = status(tx);
  return {
    hash: tx.hash,
    blockNumber: tx.ledger_index,
    timestamp: new Date(tx.date).toISOString(),
    from: tx.Account,
    to: tx.Destination ?? null,
    value,
    valueFormatted: formatWei(value, XRP_DECIMALS),
    fee: tx.Fee,
    status: result,
    isContractInteraction: false,
    tokenTransfers: result === "success" ? tokenTransfers : [],
    raw: raw as Record<string, unknown>,
  };
}

function historyWindow(options: Readonly<TxHistoryOptions> = {}) {
  if (options.sort === "asc")
    throw new ExplorerError("XRPSCAN lists account history newest first only", XRPScan.key);
  if (options.startBlock !== undefined || options.endBlock !== undefined)
    throw new ExplorerError("XRPSCAN account history takes no ledger bounds", XRPScan.key);
  return historyPage(options, MAX_HISTORY_ROWS, XRPScan.key);
}

/** XRP Ledger balances, history, trust line holdings and ledgers from XRPSCAN. */
export class XRPScan extends Provider {
  static readonly key = "xrpscan";
  private readonly base: string;

  constructor(config: Readonly<ProviderConfig> = {}) {
    super(config);
    this.base = normalizeBaseUrl(config.baseUrl ?? DEFAULT_BASE);
  }

  get capabilities(): ProviderCapabilities {
    return {
      balances: true,
      txHistory: true,
      txDetail: true,
      utxos: false,
      pubkeys: false,
      contractInfo: false,
      tokenBalances: true,
      tokenTransfers: false,
      gasData: false,
      blockInfo: true,
    };
  }

  /**
   * The whole XRP balance in drops, reserve included. An account the ledger never funded has no
   * entry at all, and XRPSCAN says so with `actNotFound` inside a 200.
   * @param {string} address - Classic `r...` address.
   * @param {ChainKey} chain - Must be the XRP Ledger.
   * @returns {Promise<Balance>} Amounts in drops.
   */
  async getBalance(address: string, chain: ChainKey = "xrpl"): Promise<Balance> {
    assertChain(chain);
    assertAccount(address);
    const raw = await this.getJSON<unknown>(`${this.base}/account/${address}`);
    if (
      z.looseObject({ error: z.looseObject({ error: z.literal("actNotFound") }) }).safeParse(raw)
        .success
    )
      throw new NotFoundError(`Account ${address}`, this.name);
    const parsed = z
      .looseObject({ Account: z.literal(address), Balance: z.string().regex(/^\d+$/) })
      .safeParse(raw);
    if (!parsed.success) throw new ExplorerError("Invalid XRPSCAN account response", this.name);
    const balance = parsed.data.Balance;
    return this.snapshotBalance({
      address,
      chain,
      balance,
      balanceFormatted: formatWei(balance, XRP_DECIMALS),
      symbol: "XRP",
    });
  }

  /**
   * Issued tokens the account holds, one per trust line with a positive balance. Each keeps the
   * decimals its value needs, since the ledger stores these amounts as decimal floats.
   * @param {string} address - Classic `r...` address.
   * @param {ChainKey} chain - Must be the XRP Ledger.
   * @param {Readonly<TokenBalanceOptions>} _options - Every holding is already above zero.
   * @returns {Promise<TokenBalance[]>} Holdings as `CURRENCY.ISSUER`.
   */
  override async getTokenBalances(
    address: string,
    chain: ChainKey = "xrpl",
    _options: Readonly<TokenBalanceOptions> = {},
  ): Promise<TokenBalance[]> {
    assertChain(chain);
    assertAccount(address);
    const raw = await this.getJSON<unknown>(`${this.base}/account/${address}/assets`);
    const parsed = z
      .array(
        z.looseObject({ counterparty: z.string(), currency: z.string().min(3), value: z.string() }),
      )
      .safeParse(raw);
    if (!parsed.success) throw new ExplorerError("Invalid XRPSCAN assets response", this.name);
    return parsed.data.flatMap((asset) => {
      const units = issuedUnits(asset.value);
      if (units === undefined) return [];
      return [
        {
          contract: tokenId(asset.currency, asset.counterparty),
          symbol: currencySymbol(asset.currency),
          decimals: units.decimals,
          balance: units.units,
          balanceFormatted: formatWei(units.units, units.decimals),
        },
      ];
    });
  }

  private async transactionsPage(address: string, marker?: string) {
    const raw = await this.getJSON<unknown>(
      `${this.base}/account/${address}/transactions${buildQuery({ marker })}`,
    );
    const parsed = z
      .looseObject({ transactions: z.array(transactionSchema()), marker: z.string().optional() })
      .safeParse(raw);
    if (!parsed.success)
      throw new ExplorerError("Invalid XRPSCAN transactions response", this.name);
    const rows = (raw as Readonly<{ transactions: readonly unknown[] }>).transactions;
    return {
      transactions: parsed.data.transactions.map((tx, index) => mapTransaction(tx, rows[index])),
      marker: parsed.data.marker,
    };
  }

  /**
   * Every transaction that touched the account, newest first. A Payment carries the XRP it
   * delivered, or its issued token in `tokenTransfers`. Any other type keeps value `"0"`.
   * @param {string} address - Classic `r...` address.
   * @param {ChainKey} chain - Must be the XRP Ledger.
   * @param {Readonly<TxHistoryOptions>} options - `limit` up to 100, `page * limit` up to 250.
   * @returns {Promise<Transaction[]>} One row per transaction.
   */
  async getTxHistory(
    address: string,
    chain: ChainKey = "xrpl",
    options?: Readonly<TxHistoryOptions>,
  ): Promise<Transaction[]> {
    assertChain(chain);
    assertAccount(address);
    const { limit, offset } = historyWindow(options);
    let rows: Transaction[] = [];
    let marker: string | undefined;
    for (let request = 0; request < MAX_HISTORY_PAGES; request += 1) {
      const page = await this.transactionsPage(address, marker);
      rows = [...rows, ...page.transactions];
      marker = page.marker;
      if (marker === undefined || rows.length >= offset + limit) break;
    }
    return rows.slice(offset, offset + limit);
  }

  /**
   * One transaction by hash, with the ledger's metadata in `raw`.
   * @param {string} hash - Transaction hash, 64 hex characters.
   * @param {ChainKey} chain - Must be the XRP Ledger.
   * @returns {Promise<Transaction>} The transaction.
   */
  override async getTxDetail(hash: string, chain: ChainKey = "xrpl"): Promise<Transaction> {
    assertChain(chain);
    if (!hashSchema().safeParse(hash).success)
      throw new ExplorerError("Invalid XRP Ledger transaction hash", this.name);
    const raw = await this.getJSON<unknown>(`${this.base}/tx/${hash}`);
    const parsed = transactionSchema().safeParse(raw);
    if (!parsed.success || parsed.data.hash.toLowerCase() !== hash.toLowerCase())
      throw new ExplorerError("Invalid XRPSCAN transaction response", this.name);
    return mapTransaction(parsed.data, raw);
  }

  /**
   * One validated ledger as a block: no miner, gas fields at zero. XRPSCAN answers an index past
   * the tip with a 500, so that surfaces as `HTTPError`, not `NotFoundError`.
   * @param {number} blockNumber - Ledger index.
   * @param {ChainKey} chain - Must be the XRP Ledger.
   * @returns {Promise<BlockInfo>} The ledger.
   */
  override async getBlockInfo(blockNumber: number, chain: ChainKey = "xrpl"): Promise<BlockInfo> {
    assertChain(chain);
    if (!Number.isSafeInteger(blockNumber) || blockNumber < 1)
      throw new ExplorerError("XRP Ledger index must be a positive safe integer", this.name);
    const raw = await this.getJSON<unknown>(`${this.base}/ledger/${blockNumber}`);
    const parsed = z
      .looseObject({
        ledger_index: z.literal(blockNumber),
        ledger_hash: hashSchema(),
        parent_hash: hashSchema(),
        close_time_human: timestampSchema(),
        tx_count: z.number().int().nonnegative(),
      })
      .safeParse(raw);
    if (!parsed.success) throw new ExplorerError("Invalid XRPSCAN ledger response", this.name);
    const ledger = parsed.data;
    return {
      number: ledger.ledger_index,
      hash: ledger.ledger_hash,
      parentHash: ledger.parent_hash,
      timestamp: new Date(ledger.close_time_human).toISOString(),
      miner: "",
      gasUsed: "0",
      gasLimit: "0",
      txCount: ledger.tx_count,
    };
  }
}
