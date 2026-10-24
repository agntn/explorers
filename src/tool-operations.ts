/**
 * What every explorer tool runs, on MCP, Pi, OMP and the CLI alike. The model reads compact JSON,
 * the same record `details` hands a host renderer. Loaded on the first call, never at import.
 */
import type { ToolResult } from "@agntn/tools";
import { UnsupportedOperationError } from "./core/errors.ts";
import { classifyInput, inferChain, resolveAddresses, resolveInput } from "./core/input.ts";
import { requireOperation } from "./core/provider.ts";
import type { ProviderCapability } from "./core/provider.ts";
import { listProviders } from "./core/registry.ts";
import type { ProviderListing } from "./core/registry.ts";
import { PROVIDER_DEFAULT_CHAIN, resolveProvider, withProvider } from "./core/resolve.ts";
import type { ProviderContext } from "./core/resolve.ts";
import { clampMaxResults, normalizeChain } from "./core/types.ts";
import type {
  Balance,
  BlockInfo,
  ChainKey,
  ContractInfo,
  GasData,
  PubkeyReveal,
  TagFilter,
  TokenBalance,
  TokenTransfer,
  Transaction,
  Utxo,
} from "./core/types.ts";
import { HISTORY_LIMIT, TOKEN_HOLDINGS_LIMIT, UNSPENT_OUTPUTS_LIMIT } from "./tool-limits.ts";

/** Where a read goes: a chain and a provider, either one left out for automatic selection. */
export interface RouteArgs {
  readonly chain?: string;
  readonly provider?: string;
}

export interface BalanceArgs extends RouteArgs {
  readonly address: string | readonly string[];
}

export interface AddressArgs extends RouteArgs {
  readonly address: string;
}

export interface HistoryArgs extends AddressArgs {
  readonly startBlock?: number;
  readonly endBlock?: number;
  readonly sort?: "asc" | "desc";
  readonly limit?: number;
  readonly page?: number;
  readonly tags?: readonly TagFilter[];
  readonly raw?: boolean;
}

export interface TxDetailArgs extends RouteArgs {
  readonly hash: string;
  readonly raw?: boolean;
}

export interface ListArgs extends AddressArgs {
  readonly limit?: number;
}

export interface TokensArgs extends ListArgs {
  readonly nonZeroOnly?: boolean;
}

export interface ContractArgs extends AddressArgs {
  readonly abi?: boolean;
  readonly sourceCode?: boolean;
}

export interface TransfersArgs extends AddressArgs {
  readonly token?: string;
  readonly startBlock?: number;
  readonly endBlock?: number;
  readonly sort?: "asc" | "desc";
  readonly limit?: number;
  readonly page?: number;
}

export interface BlockArgs extends RouteArgs {
  readonly blockNumber: number;
}

/** `tx` on the command line: an address lists history, a hash reads one transaction. */
export interface TxArgs extends RouteArgs {
  readonly target: string;
  readonly mode?: "history" | "detail";
  readonly limit?: number;
}

/** The answer of a read: the provider that served it and what it served. */
export interface ProviderDetails<T> {
  readonly provider: string;
  readonly data: T;
}

/** A listing cut to `limit`, with `total` counting every row it was cut from. */
export interface ListedDetails<T> extends ProviderDetails<T[]> {
  readonly total: number;
}

/** Unspent outputs, with the confirmed value of every output and the count still pending. */
export interface UtxoDetails extends ListedDetails<Utxo> {
  readonly confirmed: string;
  readonly pending: number;
}

export interface ProvidersDetails {
  readonly providers: ProviderListing[];
}

/** Characters JSON leaves raw that still move a terminal or flip text: C1, bidi marks, U+2028/9. */
const RAW_IN_JSON = /[\u007F-\u009F\u061C\u200E\u200F\u2028\u2029\u202A-\u202E\u2066-\u206F]/gu;

/**
 * Compact JSON with every character a terminal or a bidi reader would act on escaped as `\uXXXX`.
 * The model pays for each space, and `JSON.parse` gives back the very same record.
 *
 * @param value - The record to send.
 * @returns {string} One line of JSON.
 */
export function compactJson(value: unknown): string {
  return JSON.stringify(value).replaceAll(
    RAW_IN_JSON,
    (character) => `\\u${character.codePointAt(0)?.toString(16).padStart(4, "0") ?? ""}`,
  );
}

/**
 * Text and details of one answer.
 *
 * @param details - The record the model reads and a host renderer draws.
 * @returns {ToolResult<T>} The answer.
 */
function answer<T>(details: T): ToolResult<T> {
  return { content: [{ type: "text", text: compactJson(details) }], details };
}

/**
 * OMP sends `0` for a number the caller left alone, and no bound or page here means zero.
 *
 * @param value - Limit, page or block bound as the host sent it.
 * @returns {number | undefined} The number, or undefined for `0` and a missing one.
 */
function counted(value: number | undefined): number | undefined {
  return value === undefined || value === 0 ? undefined : value;
}

/** One read: where it goes, what it needs, which input picks its chain, and what stops it. */
interface Read {
  readonly route: RouteArgs;
  readonly capability: ProviderCapability;
  readonly input?: string | readonly string[];
  readonly signal?: AbortSignal;
}

/**
 * Runs a read on the provider selection picks, with one fallback when that one fails to answer.
 *
 * @param read - Route, capability, input and signal.
 * @param run - The read itself, safe to run twice.
 * @returns {Promise<T>} What the read returned.
 */
function select<T>(
  read: Readonly<Read>,
  /* oxlint-disable-next-line typescript/prefer-readonly-parameter-types */
  run: (selected: ProviderContext) => Promise<T>,
): Promise<T> {
  const { chain, provider } = read.route;
  return withProvider(
    provider,
    chain === undefined ? undefined : normalizeChain(chain),
    run,
    read.capability,
    read.input,
    read.signal,
  );
}

/**
 * The address a read is about, with an ENS name resolved and the chain family checked.
 *
 * @param address - Address or ENS name as the caller wrote it.
 * @param selected - The chain the read runs on, and the signal that stops ENS resolution.
 * @returns {Promise<string>} The address to send.
 */
async function addressOn(
  address: string,
  selected: Readonly<{ chain: ChainKey; signal?: AbortSignal }>,
): Promise<string> {
  return (await resolveInput(address, selected.chain, selected.signal)).address;
}

/* The provider's record dwarfs the normalized fields, so it travels only when asked for. */
/* oxlint-disable-next-line typescript/prefer-readonly-parameter-types */
function trimTransaction(transaction: Transaction, keepRaw = false): Transaction {
  if (keepRaw) return transaction;
  const { raw: _raw, ...trimmed } = transaction;
  return trimmed;
}

/* ABI and source run to tens of kilobytes; a caller after verification or proxy status skips them. */
function trimContract(
  info: Readonly<ContractInfo>,
  requested: Readonly<{ abi?: boolean; sourceCode?: boolean }>,
): ContractInfo {
  const { abi, sourceCode, ...trimmed } = info;
  const contract: ContractInfo = trimmed;
  if (requested.abi) contract.abi = abi;
  if (requested.sourceCode) contract.sourceCode = sourceCode;
  return contract;
}

/**
 * Lists every registered provider from registry metadata, without contacting an explorer.
 *
 * @returns {ToolResult<ProvidersDetails>} The listing as a JSON array.
 */
export function providers(): ToolResult<ProvidersDetails> {
  const listed = listProviders();
  return { content: [{ type: "text", text: compactJson(listed) }], details: { providers: listed } };
}

/**
 * Reads the native balance of one address, or of each in a list.
 *
 * @param args - Address or addresses, chain and provider.
 * @param signal - Stops the read and ENS resolution.
 * @returns {Promise<ToolResult<ProviderDetails<Balance | Balance[]>>>} One balance, or one per address.
 */
export function balance(
  args: Readonly<BalanceArgs>,
  signal?: AbortSignal,
): Promise<ToolResult<ProviderDetails<Balance | Balance[]>>> {
  const read = { route: args, capability: "balances", input: args.address, signal } as const;
  return select(read, async (selected) => {
    const addresses = await resolveAddresses(args.address, selected.chain, signal);
    const getBalance = requireOperation(selected.provider, "getBalance");
    const balances = await Promise.all(
      addresses.map((address) => getBalance(address, selected.chain)),
    );
    /* A host may hand a list over as a JSON string, which still answers one balance per address. */
    const [single] = balances;
    const data =
      typeof args.address === "string" && balances.length === 1 && single ? single : balances;
    return answer({ provider: selected.name, data });
  });
}

/**
 * Lists the transactions of an address, filtered by tags where the provider can apply them.
 *
 * @param args - Address, route, bounds, order, page, tags and whether to keep raw records.
 * @param signal - Stops the read.
 * @returns {Promise<ToolResult<ProviderDetails<Transaction[]>>>} The normalized transactions.
 */
export function txHistory(
  args: Readonly<HistoryArgs>,
  signal?: AbortSignal,
): Promise<ToolResult<ProviderDetails<Transaction[]>>> {
  const filtered = args.tags !== undefined && args.tags.length > 0;
  const options = {
    startBlock: counted(args.startBlock),
    endBlock: counted(args.endBlock),
    sort: args.sort,
    limit: counted(args.limit) ?? HISTORY_LIMIT,
    page: counted(args.page),
    tags: args.tags,
  };
  const capability = filtered ? "txHistoryTags" : "txHistory";
  return select({ route: args, capability, input: args.address, signal }, async (selected) => {
    const getTxHistory = requireOperation(selected.provider, "getTxHistory");
    if (filtered && selected.provider.capabilities.txHistoryTags !== true)
      throw new UnsupportedOperationError("txHistoryTags", selected.name);
    const address = await addressOn(args.address, { chain: selected.chain, signal });
    const transactions = await getTxHistory(address, selected.chain, options);
    return answer({
      provider: selected.name,
      data: transactions.map((transaction) => trimTransaction(transaction, args.raw)),
    });
  });
}

/**
 * Reads one transaction by hash.
 *
 * @param args - Hash, route and whether to keep the raw record.
 * @param signal - Stops the read.
 * @returns {Promise<ToolResult<ProviderDetails<Transaction>>>} The normalized transaction.
 */
export function txDetail(
  args: Readonly<TxDetailArgs>,
  signal?: AbortSignal,
): Promise<ToolResult<ProviderDetails<Transaction>>> {
  return select({ route: args, capability: "txDetail", signal }, async (selected) => {
    const getTxDetail = requireOperation(selected.provider, "getTxDetail");
    const transaction = await getTxDetail(args.hash, selected.chain);
    return answer({ provider: selected.name, data: trimTransaction(transaction, args.raw) });
  });
}

/**
 * Lists the unspent outputs of an address, cut to `limit`, counting and summing every one.
 *
 * @param args - Address, route and limit.
 * @param signal - Stops the read.
 * @returns {Promise<ToolResult<UtxoDetails>>} The listed outputs with the totals.
 */
export function utxos(
  args: Readonly<ListArgs>,
  signal?: AbortSignal,
): Promise<ToolResult<UtxoDetails>> {
  const read = { route: args, capability: "utxos", input: args.address, signal } as const;
  return select(read, async (selected) => {
    const address = await addressOn(args.address, { chain: selected.chain, signal });
    const getUtxos = requireOperation(selected.provider, "getUtxos");
    const outputs = await getUtxos(address, selected.chain);
    const confirmed = outputs.filter((output) => output.confirmed);
    return answer({
      provider: selected.name,
      total: outputs.length,
      confirmed: confirmed.reduce((sum, output) => sum + BigInt(output.value), 0n).toString(),
      pending: outputs.length - confirmed.length,
      data: outputs.slice(0, clampMaxResults(counted(args.limit) ?? UNSPENT_OUTPUTS_LIMIT)),
    });
  });
}

/**
 * Tells whether an address has shown its public key on chain.
 *
 * @param args - Address and route.
 * @param signal - Stops the read.
 * @returns {Promise<ToolResult<ProviderDetails<PubkeyReveal>>>} The key and the transaction that showed it.
 */
export function pubkey(
  args: Readonly<AddressArgs>,
  signal?: AbortSignal,
): Promise<ToolResult<ProviderDetails<PubkeyReveal>>> {
  const read = { route: args, capability: "pubkeys", input: args.address, signal } as const;
  return select(read, async (selected) => {
    const address = await addressOn(args.address, { chain: selected.chain, signal });
    const getPubkey = requireOperation(selected.provider, "getPubkey");
    return answer({ provider: selected.name, data: await getPubkey(address, selected.chain) });
  });
}

/**
 * Reads contract metadata, with the ABI and source only when asked for.
 *
 * @param args - Address, route and which payloads to keep.
 * @param signal - Stops the read.
 * @returns {Promise<ToolResult<ProviderDetails<ContractInfo>>>} The contract record.
 */
export function contract(
  args: Readonly<ContractArgs>,
  signal?: AbortSignal,
): Promise<ToolResult<ProviderDetails<ContractInfo>>> {
  const read = { route: args, capability: "contractInfo", input: args.address, signal } as const;
  return select(read, async (selected) => {
    const getContractInfo = requireOperation(selected.provider, "getContractInfo");
    const address = await addressOn(args.address, { chain: selected.chain, signal });
    const info = await getContractInfo(address, selected.chain);
    return answer({ provider: selected.name, data: trimContract(info, args) });
  });
}

/**
 * Lists the token holdings of an address, cut to `limit`, counting every one.
 *
 * @param args - Address, route, limit and whether to drop zero balances.
 * @param signal - Stops the read.
 * @returns {Promise<ToolResult<ListedDetails<TokenBalance>>>} The listed holdings.
 */
export function tokens(
  args: Readonly<TokensArgs>,
  signal?: AbortSignal,
): Promise<ToolResult<ListedDetails<TokenBalance>>> {
  const read = { route: args, capability: "tokenBalances", input: args.address, signal } as const;
  return select(read, async (selected) => {
    const address = await addressOn(args.address, { chain: selected.chain, signal });
    const getTokenBalances = requireOperation(selected.provider, "getTokenBalances");
    const holdings = await getTokenBalances(address, selected.chain, {
      nonZeroOnly: args.nonZeroOnly ?? true,
    });
    return answer({
      provider: selected.name,
      total: holdings.length,
      data: holdings.slice(0, clampMaxResults(counted(args.limit) ?? TOKEN_HOLDINGS_LIMIT)),
    });
  });
}

/**
 * Lists fungible-token transfers involving an address.
 *
 * @param args - Address, route, token, bounds, order, limit and page.
 * @param signal - Stops the read.
 * @returns {Promise<ToolResult<ProviderDetails<TokenTransfer[]>>>} The transfers.
 */
export function tokenTransfers(
  args: Readonly<TransfersArgs>,
  signal?: AbortSignal,
): Promise<ToolResult<ProviderDetails<TokenTransfer[]>>> {
  const options = {
    token: args.token,
    startBlock: counted(args.startBlock),
    endBlock: counted(args.endBlock),
    sort: args.sort,
    limit: counted(args.limit) ?? HISTORY_LIMIT,
    page: counted(args.page),
  };
  const read = { route: args, capability: "tokenTransfers", input: args.address, signal } as const;
  return select(read, async (selected) => {
    const address = await addressOn(args.address, { chain: selected.chain, signal });
    const getTokenTransfers = requireOperation(selected.provider, "getTokenTransfers");
    return answer({
      provider: selected.name,
      data: await getTokenTransfers(address, selected.chain, options),
    });
  });
}

/**
 * Reads gas or fee-market suggestions.
 *
 * @param args - Route.
 * @param signal - Stops the read.
 * @returns {Promise<ToolResult<ProviderDetails<GasData>>>} The suggestions.
 */
export function gas(
  args: Readonly<RouteArgs>,
  signal?: AbortSignal,
): Promise<ToolResult<ProviderDetails<GasData>>> {
  return select({ route: args, capability: "gasData", signal }, async (selected) => {
    const getGasData = requireOperation(selected.provider, "getGasData");
    return answer({ provider: selected.name, data: await getGasData(selected.chain) });
  });
}

/**
 * Reads one block by number.
 *
 * @param args - Block number and route.
 * @param signal - Stops the read.
 * @returns {Promise<ToolResult<ProviderDetails<BlockInfo>>>} The normalized block.
 */
export function block(
  args: Readonly<BlockArgs>,
  signal?: AbortSignal,
): Promise<ToolResult<ProviderDetails<BlockInfo>>> {
  return select({ route: args, capability: "blockInfo", signal }, async (selected) => {
    const getBlockInfo = requireOperation(selected.provider, "getBlockInfo");
    return answer({
      provider: selected.name,
      data: await getBlockInfo(args.blockNumber, selected.chain),
    });
  });
}

/**
 * The chain a `tx` read starts on and whether its target is a transaction hash or an address there.
 *
 * @param args - Target, route and the mode the caller asked for.
 * @returns {{ chain: ChainKey; mode: "history" | "detail" }} The chain and the read to run.
 */
function txRoute(args: Readonly<TxArgs>): { chain: ChainKey; mode: "history" | "detail" } {
  const { provider } = args;
  const requested =
    args.chain === undefined ? inferChain(args.target, provider) : normalizeChain(args.chain);
  const chain =
    requested ?? normalizeChain(PROVIDER_DEFAULT_CHAIN[resolveProvider(provider, requested)]);
  const mode =
    args.mode ?? (classifyInput(args.target.trim(), chain) === "txhash" ? "detail" : "history");
  return { chain, mode };
}

/**
 * `tx` on the command line: history for an address, detail for a hash, `mode` for a format both share.
 *
 * @param args - Target, route, mode and history limit.
 * @param signal - Stops the read.
 * @returns {Promise<ToolResult<ProviderDetails<Transaction | Transaction[]>>>} One transaction or a history.
 */
export function tx(
  args: Readonly<TxArgs>,
  signal?: AbortSignal,
): Promise<ToolResult<ProviderDetails<Transaction | Transaction[]>>> {
  const { chain, mode } = txRoute(args);
  const route = { chain, provider: args.provider };
  return mode === "detail"
    ? txDetail({ ...route, hash: args.target.trim() }, signal)
    : txHistory({ ...route, address: args.target, limit: args.limit }, signal);
}
