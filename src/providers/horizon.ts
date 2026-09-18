/**
 * Horizon provider: Stellar accounts, payments, transactions, ledgers and fee stats.
 *
 * Horizon is the HTTP API the Stellar Development Foundation serves over the network. The public
 * instance at horizon.stellar.org needs no key and keeps one year of history; `baseUrl` points the
 * provider at any other Horizon.
 *
 * https://developers.stellar.org/docs/data/apis/horizon
 */

import { getChain } from "@agntn/chains";
import { z } from "zod";
import { Provider } from "../core/provider.js";
import { buildQuery, normalizeBaseUrl } from "../core/client.js";
import { HORIZON_URL } from "../core/endpoints.js";
import { ExplorerError, UnsupportedChainError } from "../core/errors.js";
import { clampMaxResults, formatWei } from "../core/types.js";
import type {
  Balance,
  BlockInfo,
  ChainKey,
  GasData,
  ProviderCapabilities,
  ProviderConfig,
  TokenBalance,
  TokenBalanceOptions,
  TokenTransfer,
  TokenTransferOptions,
  Transaction,
  TxHistoryOptions,
} from "../core/types.js";

/** Stellar amounts carry seven decimals; the smallest unit is the stroop. */
const STROOP_DECIMALS = 7;
/** Horizon caps every collection page at 200 records. */
const PAGE_LIMIT = 200;
/** A history `page` is reached by walking cursors, one request per page. */
const MAX_PAGE = 10;
/** Token transfers are filtered out of payments, so a read scans at most this many full pages. */
const TRANSFER_SCAN_PAGES = 5;
/** Operations Horizon lists under payments that move a native or issued asset between accounts. */
const PAYMENT_TYPES: readonly string[] = [
  "payment",
  "path_payment_strict_send",
  "path_payment_strict_receive",
];
/** Operations Horizon lists under payments, in the order the row selection prefers them. */
const PARTY_TYPES: readonly string[] = [
  ...PAYMENT_TYPES,
  "create_account",
  "account_merge",
  "invoke_host_function",
];
/** Soroban operations, the only ones that run contract code. */
const SOROBAN_TYPES: readonly string[] = [
  "invoke_host_function",
  "extend_footprint_ttl",
  "restore_footprint",
];

function assertChain(chain: ChainKey): void {
  if (chain !== "stellar") throw new UnsupportedChainError(chain, Horizon.key);
}

function assertAccount(address: string): void {
  try {
    getChain("stellar").assertAddress(address);
  } catch {
    throw new ExplorerError("Invalid Stellar account id", Horizon.key);
  }
}

function hashSchema() {
  return z.string().regex(/^[a-fA-F0-9]{64}$/);
}

function amountSchema() {
  return z.string().regex(/^\d+(?:\.\d{1,7})?$/);
}

function stroopsSchema() {
  return z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]);
}

function addressTextSchema() {
  return z.string().regex(/^[A-Z0-9]{1,69}$/);
}

function timestampSchema() {
  return z.string().refine((value) => !Number.isNaN(Date.parse(value)));
}

function transactionSchema() {
  return z.looseObject({
    hash: hashSchema(),
    ledger: z.number().int().positive(),
    created_at: timestampSchema(),
    source_account: addressTextSchema(),
    fee_charged: stroopsSchema(),
    operation_count: z.number().int().positive(),
    successful: z.boolean(),
  });
}

function balanceChangeSchema() {
  return z.looseObject({
    asset_type: z.string(),
    asset_code: z.string().optional(),
    asset_issuer: addressTextSchema().optional(),
    type: z.string(),
    from: addressTextSchema().optional(),
    to: addressTextSchema().optional(),
    amount: amountSchema(),
  });
}

function operationSchema() {
  return z.looseObject({
    paging_token: z.string().regex(/^\d+$/),
    transaction_successful: z.boolean(),
    source_account: addressTextSchema(),
    type: z.string(),
    created_at: timestampSchema(),
    transaction_hash: hashSchema(),
    asset_type: z.string().optional(),
    asset_code: z.string().optional(),
    asset_issuer: addressTextSchema().optional(),
    from: addressTextSchema().optional(),
    to: addressTextSchema().optional(),
    amount: amountSchema().optional(),
    starting_balance: amountSchema().optional(),
    funder: addressTextSchema().optional(),
    account: addressTextSchema().optional(),
    into: addressTextSchema().optional(),
    function: z.string().optional(),
    asset_balance_changes: z.array(balanceChangeSchema()).optional(),
    transaction: transactionSchema().optional(),
  });
}

function pageSchema<T extends z.ZodTypeAny>(record: T) {
  return z.looseObject({ _embedded: z.object({ records: z.array(record) }) });
}

/** The asset fields Horizon repeats on balances, payments and balance changes. */
interface AssetHolder {
  readonly asset_type?: string;
  readonly asset_code?: string;
  readonly asset_issuer?: string;
}

/** One movement a contract call caused, as Horizon lists it under `asset_balance_changes`. */
interface AssetChange extends AssetHolder {
  readonly [key: string]: unknown;
  readonly type: string;
  readonly from?: string;
  readonly to?: string;
  readonly amount: string;
}

/** The transaction fields the rows read, whether joined onto a payment or fetched alone. */
interface HorizonTransaction {
  readonly [key: string]: unknown;
  readonly hash: string;
  readonly ledger: number;
  readonly created_at: string;
  readonly source_account: string;
  readonly fee_charged: string | number;
  readonly operation_count: number;
  readonly successful: boolean;
}

/** One operation record, with the fields of every payment-like type optional. */
interface HorizonOperation extends AssetHolder {
  readonly [key: string]: unknown;
  readonly paging_token: string;
  readonly transaction_successful: boolean;
  readonly source_account: string;
  readonly type: string;
  readonly created_at: string;
  readonly transaction_hash: string;
  readonly from?: string;
  readonly to?: string;
  readonly amount?: string;
  readonly starting_balance?: string;
  readonly funder?: string;
  readonly account?: string;
  readonly into?: string;
  readonly function?: string;
  readonly asset_balance_changes?: readonly AssetChange[];
  readonly transaction?: HorizonTransaction;
}

/** Where a transfer lands in the normalized rows. */
interface RowContext {
  readonly txHash: string;
  readonly blockNumber: number;
  readonly timestamp: string;
}

/** The parties and amounts one operation moves, in the shape of a transaction row. */
interface Parties {
  readonly from: string;
  readonly to: string | null;
  readonly value: string;
  readonly tokenTransfers: TokenTransfer[];
}

/**
 * Convert a Horizon decimal amount to stroops without touching floats.
 * @param {string} amount - Amount with up to seven decimals, as Horizon prints it.
 * @returns {string} Exact integer stroops.
 */
function toStroops(amount: string): string {
  const match = /^(\d+)(?:\.(\d{1,7}))?$/.exec(amount);
  if (!match) throw new ExplorerError("Invalid Horizon amount", Horizon.key);
  const whole = BigInt(match[1] ?? "0") * 10n ** BigInt(STROOP_DECIMALS);
  return (whole + BigInt((match[2] ?? "").padEnd(STROOP_DECIMALS, "0"))).toString();
}

function toIso(timestamp: string): string {
  return new Date(timestamp).toISOString();
}

/**
 * Name an issued asset the way SEP-11 spells it.
 * @param {AssetHolder} asset - Record carrying `asset_code` and `asset_issuer`.
 * @returns {string} `CODE:ISSUER`.
 */
function assetId(asset: AssetHolder): string {
  return `${asset.asset_code ?? ""}:${asset.asset_issuer ?? ""}`;
}

function isNative(asset: AssetHolder): boolean {
  return asset.asset_type === "native";
}

function tokenTransfer(
  asset: AssetHolder,
  amount: string,
  from: string,
  to: string,
  context: RowContext,
): TokenTransfer {
  const value = toStroops(amount);
  return {
    contract: assetId(asset),
    symbol: asset.asset_code ?? "",
    decimals: STROOP_DECIMALS,
    value,
    valueFormatted: formatWei(value, STROOP_DECIMALS),
    from,
    to,
    ...context,
  };
}

function createAccountParties(op: HorizonOperation): Parties {
  return {
    from: op.funder ?? op.source_account,
    to: op.account ?? null,
    value: toStroops(op.starting_balance ?? "0"),
    tokenTransfers: [],
  };
}

/**
 * Horizon does not put the merged amount on the operation, so the row keeps zero.
 * @param {HorizonOperation} op - An `account_merge` record.
 * @returns {Parties} Merged account and its destination.
 */
function mergeParties(op: HorizonOperation): Parties {
  return {
    from: op.account ?? op.source_account,
    to: op.into ?? null,
    value: "0",
    tokenTransfers: [],
  };
}

function paymentParties(op: HorizonOperation, context: RowContext): Parties {
  const from = op.from ?? op.source_account;
  const to = op.to ?? null;
  const amount = op.amount ?? "0";
  if (isNative(op)) return { from, to, value: toStroops(amount), tokenTransfers: [] };
  return {
    from,
    to,
    value: "0",
    tokenTransfers: [tokenTransfer(op, amount, from, to ?? "", context)],
  };
}

/**
 * A contract call moves assets through its balance changes; the first native one names the parties.
 * @param {HorizonOperation} op - An `invoke_host_function` record.
 * @param {RowContext} context - Hash, ledger and time of the transaction.
 * @returns {Parties} Native movement as the row, issued assets as token transfers.
 */
function invocationParties(op: HorizonOperation, context: RowContext): Parties {
  const changes = op.asset_balance_changes ?? [];
  const native = changes.find(isNative);
  return {
    from: native?.from ?? op.source_account,
    to: native?.to ?? null,
    value: native === undefined ? "0" : toStroops(native.amount),
    tokenTransfers: changes
      .filter((change) => !isNative(change))
      .map((change) =>
        tokenTransfer(change, change.amount, change.from ?? "", change.to ?? "", context),
      ),
  };
}

/**
 * Name the Soroban call the way the operation type is spelled, `invoke_contract` for the usual one.
 * @param {HorizonOperation} op - Any operation; only Soroban ones get a name.
 * @returns {string | undefined} The host function in snake case, the operation type without one.
 */
function sorobanFunction(op: HorizonOperation): string | undefined {
  if (!SOROBAN_TYPES.includes(op.type)) return undefined;
  const name = (op.function ?? "").replace(/^(?:HostFunctionType)+/, "");
  return name === "" ? op.type : name.replaceAll(/(?<=[a-z])(?=[A-Z])/g, "_").toLowerCase();
}

function operationParties(op: HorizonOperation, context: RowContext): Parties {
  if (PAYMENT_TYPES.includes(op.type)) return paymentParties(op, context);
  if (op.type === "create_account") return createAccountParties(op);
  if (op.type === "account_merge") return mergeParties(op);
  if (op.type === "invoke_host_function") return invocationParties(op, context);
  return { from: op.source_account, to: null, value: "0", tokenTransfers: [] };
}

/**
 * The fee belongs to the transaction, so a row carries it only when it is the whole transaction.
 * @param {HorizonTransaction} transaction - The joined transaction, when Horizon sent one.
 * @returns {{ fee?: string }} The fee field for a single-operation transaction, else nothing.
 */
function operationFee(transaction?: HorizonTransaction) {
  if (transaction === undefined || transaction.operation_count !== 1) return {};
  return { fee: String(transaction.fee_charged) };
}

function mapOperation(op: HorizonOperation): Transaction {
  const blockNumber = op.transaction?.ledger ?? 0;
  const timestamp = toIso(op.created_at);
  const parties = operationParties(op, { txHash: op.transaction_hash, blockNumber, timestamp });
  return {
    hash: op.transaction_hash,
    blockNumber,
    timestamp,
    from: parties.from,
    to: parties.to,
    value: parties.value,
    valueFormatted: formatWei(parties.value, STROOP_DECIMALS),
    ...operationFee(op.transaction),
    status: op.transaction_successful ? "success" : "failed",
    ...(SOROBAN_TYPES.includes(op.type) ? { functionName: sorobanFunction(op) } : {}),
    isContractInteraction: SOROBAN_TYPES.includes(op.type),
    tokenTransfers: op.transaction_successful ? parties.tokenTransfers : [],
    raw: { ...op },
  };
}

function mapTransaction(tx: HorizonTransaction, ops: readonly HorizonOperation[]): Transaction {
  const timestamp = toIso(tx.created_at);
  const context = { txHash: tx.hash, blockNumber: tx.ledger, timestamp };
  const primary = ops.find((op) => PARTY_TYPES.includes(op.type)) ?? ops[0];
  const soroban = ops.find((op) => SOROBAN_TYPES.includes(op.type));
  const parties =
    primary === undefined
      ? { from: tx.source_account, to: null, value: "0" }
      : operationParties(primary, context);
  return {
    hash: tx.hash,
    blockNumber: tx.ledger,
    timestamp,
    from: parties.from,
    to: parties.to,
    value: parties.value,
    valueFormatted: formatWei(parties.value, STROOP_DECIMALS),
    fee: String(tx.fee_charged),
    status: tx.successful ? "success" : "failed",
    ...(soroban === undefined ? {} : { functionName: sorobanFunction(soroban) }),
    isContractInteraction: soroban !== undefined,
    tokenTransfers: tx.successful
      ? ops.flatMap((op) => operationParties(op, context).tokenTransfers)
      : [],
    raw: { ...tx },
  };
}

function matchingTransfers(records: readonly HorizonOperation[], token?: string): TokenTransfer[] {
  return records
    .flatMap((op) => mapOperation(op).tokenTransfers)
    .filter((transfer) => token === undefined || transfer.contract === token);
}

function historyWindow(options: Readonly<TxHistoryOptions>, max: number) {
  const page = options.page ?? 1;
  if (!Number.isInteger(page) || page < 1 || page > MAX_PAGE)
    throw new ExplorerError(`Horizon history walks pages 1 to ${MAX_PAGE}`, Horizon.key);
  if (options.startBlock !== undefined || options.endBlock !== undefined)
    throw new ExplorerError("Horizon account history does not support ledger bounds", Horizon.key);
  return {
    limit: clampMaxResults(options.limit, max),
    order: options.sort === "asc" ? "asc" : "desc",
    page,
  };
}

/** Stellar accounts, payments, transactions, ledgers and fee stats from a Horizon server. */
export class Horizon extends Provider {
  static readonly key = "horizon";
  private readonly base: string;

  constructor(config: Readonly<ProviderConfig> = {}) {
    super(config);
    this.base = normalizeBaseUrl(config.baseUrl ?? HORIZON_URL);
  }

  get capabilities(): ProviderCapabilities {
    return {
      balances: true,
      txHistory: true,
      txDetail: true,
      utxos: false,
      contractInfo: false,
      tokenBalances: true,
      tokenTransfers: true,
      gasData: true,
      blockInfo: true,
    };
  }

  private async account(address: string) {
    const raw = await this.getJSON<unknown>(`${this.base}/accounts/${address}`);
    const parsed = z
      .looseObject({
        id: z.literal(address),
        balances: z.array(
          z.looseObject({
            asset_type: z.string(),
            balance: amountSchema(),
            asset_code: z.string().optional(),
            asset_issuer: addressTextSchema().optional(),
          }),
        ),
      })
      .safeParse(raw);
    if (!parsed.success) throw new ExplorerError("Invalid Horizon account response", this.name);
    return parsed.data;
  }

  /**
   * The whole native balance in stroops, reserve included; an account never funded is a 404.
   * @param {string} address - Stellar account id, the `G...` form.
   * @param {ChainKey} chain - Must be Stellar.
   * @returns {Promise<Balance>} Amounts in stroops.
   */
  async getBalance(address: string, chain: ChainKey = "stellar"): Promise<Balance> {
    assertChain(chain);
    assertAccount(address);
    const account = await this.account(address);
    const balance = toStroops(account.balances.find(isNative)?.balance ?? "0");
    return this.snapshotBalance({
      address,
      chain,
      balance,
      balanceFormatted: formatWei(balance, STROOP_DECIMALS),
      symbol: "XLM",
    });
  }

  /**
   * The account's trustlines as `CODE:ISSUER` holdings; liquidity pool shares stay out.
   * @param {string} address - Stellar account id.
   * @param {ChainKey} chain - Must be Stellar.
   * @param {Readonly<TokenBalanceOptions>} options - `nonZeroOnly` drops empty trustlines.
   * @returns {Promise<TokenBalance[]>} Holdings with seven decimals each.
   */
  override async getTokenBalances(
    address: string,
    chain: ChainKey = "stellar",
    options: Readonly<TokenBalanceOptions> = {},
  ): Promise<TokenBalance[]> {
    assertChain(chain);
    assertAccount(address);
    const account = await this.account(address);
    const holdings = account.balances
      .filter((entry) => entry.asset_type.startsWith("credit_alphanum"))
      .map((entry) => {
        const balance = toStroops(entry.balance);
        return {
          contract: assetId(entry),
          symbol: entry.asset_code ?? "",
          decimals: STROOP_DECIMALS,
          balance,
          balanceFormatted: formatWei(balance, STROOP_DECIMALS),
        };
      });
    return options.nonZeroOnly ? holdings.filter((holding) => holding.balance !== "0") : holdings;
  }

  private async paymentsPage(address: string, order: string, limit: number, cursor?: string) {
    const query = buildQuery({
      order,
      limit,
      include_failed: "true",
      join: "transactions",
      cursor,
    });
    const raw = await this.getJSON<unknown>(`${this.base}/accounts/${address}/payments${query}`);
    const parsed = pageSchema(operationSchema()).safeParse(raw);
    if (!parsed.success || parsed.data._embedded.records.length > limit)
      throw new ExplorerError("Invalid Horizon payments response", this.name);
    return parsed.data._embedded.records;
  }

  private async walkPayments(address: string, order: string, limit: number, page: number) {
    let cursor: string | undefined;
    let records: HorizonOperation[] = [];
    for (let index = 1; index <= page; index += 1) {
      records = await this.paymentsPage(address, order, limit, cursor);
      if (records.length < limit) return index === page ? records : [];
      cursor = records.at(-1)?.paging_token;
    }
    return records;
  }

  /**
   * Horizon's payments view, one row per operation, so rows of one transaction share its hash and
   * only a single-operation transaction carries its fee. Issued assets ride in `tokenTransfers`.
   * @param {string} address - Stellar account id.
   * @param {ChainKey} chain - Must be Stellar.
   * @param {Readonly<TxHistoryOptions>} options - `limit` up to 200, `page` up to 10, no bounds.
   * @returns {Promise<Transaction[]>} Operation rows.
   */
  async getTxHistory(
    address: string,
    chain: ChainKey = "stellar",
    options: Readonly<TxHistoryOptions> = {},
  ): Promise<Transaction[]> {
    assertChain(chain);
    assertAccount(address);
    const { limit, order, page } = historyWindow(options, PAGE_LIMIT);
    const records = await this.walkPayments(address, order, limit, page);
    return records.map(mapOperation);
  }

  /**
   * Issued-asset payments, filtered here because Horizon has no asset filter: the read walks up to
   * five pages of 200 payments and keeps what moved an asset, `token` one `CODE:ISSUER` of them.
   * @param {string} address - Stellar account id.
   * @param {ChainKey} chain - Must be Stellar.
   * @param {Readonly<TokenTransferOptions>} options - `limit` up to 100, `page` up to 10, `token`.
   * @returns {Promise<TokenTransfer[]>} Transfers found inside the scanned window.
   */
  override async getTokenTransfers(
    address: string,
    chain: ChainKey = "stellar",
    options: Readonly<TokenTransferOptions> = {},
  ): Promise<TokenTransfer[]> {
    assertChain(chain);
    assertAccount(address);
    const { limit, order, page } = historyWindow(options, 100);
    const wanted = page * limit;
    let transfers: TokenTransfer[] = [];
    let cursor: string | undefined;
    for (
      let scanned = 0;
      scanned < TRANSFER_SCAN_PAGES && transfers.length < wanted;
      scanned += 1
    ) {
      const records = await this.paymentsPage(address, order, PAGE_LIMIT, cursor);
      transfers = [...transfers, ...matchingTransfers(records, options.token)];
      if (records.length < PAGE_LIMIT) break;
      cursor = records.at(-1)?.paging_token;
    }
    return transfers.slice(wanted - limit, wanted);
  }

  /**
   * One transaction with its operations: the first payment-like one names the parties and the
   * native value, every issued-asset movement lands in `tokenTransfers`.
   * @param {string} hash - Transaction hash, 64 hex characters.
   * @param {ChainKey} chain - Must be Stellar.
   * @returns {Promise<Transaction>} The transaction, with Horizon's record in `raw`.
   */
  override async getTxDetail(hash: string, chain: ChainKey = "stellar"): Promise<Transaction> {
    assertChain(chain);
    if (!hashSchema().safeParse(hash).success)
      throw new ExplorerError("Invalid Stellar transaction hash", this.name);
    const query = buildQuery({ limit: PAGE_LIMIT, include_failed: "true" });
    const [rawTx, rawOps] = await Promise.all([
      this.getJSON<unknown>(`${this.base}/transactions/${hash}`),
      this.getJSON<unknown>(`${this.base}/transactions/${hash}/operations${query}`),
    ]);
    const tx = transactionSchema().safeParse(rawTx);
    const ops = pageSchema(operationSchema()).safeParse(rawOps);
    if (!tx.success || !ops.success || tx.data.hash.toLowerCase() !== hash.toLowerCase())
      throw new ExplorerError("Invalid Horizon transaction response", this.name);
    return mapTransaction(tx.data, ops.data._embedded.records);
  }

  /**
   * Per-operation fees over the last five ledgers: the base fee, the fee most operations paid and
   * the 95th percentile, which Soroban resource fees own. No middle tier is worth quoting.
   * @param {ChainKey} chain - Must be Stellar.
   * @returns {Promise<GasData>} Fee figures in stroops.
   */
  override async getGasData(chain: ChainKey = "stellar"): Promise<GasData> {
    assertChain(chain);
    const raw = await this.getJSON<unknown>(`${this.base}/fee_stats`);
    const digits = z.string().regex(/^\d+$/);
    const parsed = z
      .looseObject({
        last_ledger_base_fee: digits,
        fee_charged: z.looseObject({ mode: digits, p95: digits }),
      })
      .safeParse(raw);
    if (!parsed.success) throw new ExplorerError("Invalid Horizon fee stats response", this.name);
    const { fee_charged: charged, last_ledger_base_fee: baseFee } = parsed.data;
    return {
      chain,
      unit: "stroops",
      safeGasPrice: charged.mode,
      fastGasPrice: charged.p95,
      baseFee,
    };
  }

  /**
   * One ledger as a block: no miner, gas fields at zero, `baseFee` in stroops and `txCount` with
   * the failed transactions counted in.
   * @param {number} blockNumber - Ledger sequence.
   * @param {ChainKey} chain - Must be Stellar.
   * @returns {Promise<BlockInfo>} The ledger.
   */
  override async getBlockInfo(
    blockNumber: number,
    chain: ChainKey = "stellar",
  ): Promise<BlockInfo> {
    assertChain(chain);
    if (!Number.isSafeInteger(blockNumber) || blockNumber < 1)
      throw new ExplorerError("Stellar ledger sequence must be a positive safe integer", this.name);
    const raw = await this.getJSON<unknown>(`${this.base}/ledgers/${blockNumber}`);
    const count = z.number().int().nonnegative();
    const parsed = z
      .looseObject({
        sequence: z.literal(blockNumber),
        hash: hashSchema(),
        prev_hash: hashSchema().optional(),
        closed_at: timestampSchema(),
        successful_transaction_count: count,
        failed_transaction_count: count,
        base_fee_in_stroops: count,
      })
      .safeParse(raw);
    if (!parsed.success) throw new ExplorerError("Invalid Horizon ledger response", this.name);
    const ledger = parsed.data;
    return {
      number: ledger.sequence,
      hash: ledger.hash,
      parentHash: ledger.prev_hash ?? "",
      timestamp: toIso(ledger.closed_at),
      miner: "",
      gasUsed: "0",
      gasLimit: "0",
      txCount: ledger.successful_transaction_count + ledger.failed_transaction_count,
      baseFee: String(ledger.base_fee_in_stroops),
    };
  }
}
