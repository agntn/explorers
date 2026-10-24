/**
 * How a Pi or OMP terminal draws an answer the model reads as JSON: one record per line, read off
 * `details`. Explorer fields are text a stranger chose, so the renderer sanitizes every line.
 * Nothing here imports the library, so `tools.ts` stays light.
 */
import { sanitizeText } from "@agntn/tools";
import type { ProviderListing } from "./core/registry.ts";
import type {
  Balance,
  BlockInfo,
  ContractInfo,
  GasData,
  Inscription,
  OpReturnPayload,
  PubkeyReveal,
  TokenBalance,
  TokenTransfer,
  Transaction,
  Utxo,
} from "./core/types.ts";
import type {
  ListedDetails,
  ProviderDetails,
  ProvidersDetails,
  UtxoDetails,
} from "./tool-operations.ts";

/* The suffix appears only when the list stops short of every row it was cut from. */
function listedCount(listed: number, total: number): string {
  return listed < total ? `, ${listed} listed` : "";
}

/* One balance on one line: formatted and raw, the totals and the moment it reflects. */
function describeBalance(name: string, balance: Readonly<Balance>): string {
  const totals =
    balance.funded === undefined || balance.spent === undefined
      ? ""
      : `; funded ${balance.funded}, spent ${balance.spent}`;
  const unconfirmed =
    balance.unconfirmed === undefined
      ? ""
      : `; unconfirmed delta ${balance.unconfirmed} base units`;
  const block = balance.blockNumber === null ? "block unknown" : `block ${balance.blockNumber}`;
  const hash = balance.blockHash === null ? "" : `; hash ${balance.blockHash}`;
  return `[${name}] ${balance.chain} balance for ${balance.address}: ${balance.balanceFormatted} ${balance.symbol} (${balance.balance} base units${totals}${unconfirmed}; fetched ${balance.fetchedAt}; ${block}${hash})`;
}

/* One OP_RETURN payload; its own breaks indent, so none can pose as a field. */
function describeOpReturn(payload: Readonly<OpReturnPayload>): string[] {
  const [first = "", ...rest] = (payload.text ?? payload.hex).split("\n");
  return [`OP_RETURN: ${first}`, ...rest.map((line) => `  ${line}`)];
}

/* What an inscription declares and how big it is, then its body indented below the label. */
function describeInscription(inscription: Readonly<Inscription>): string[] {
  const encoding = inscription.contentEncoding ? `, ${inscription.contentEncoding}` : "";
  const head = `Inscription: ${inscription.contentType ?? "no content type"}, ${inscription.size} bytes${encoding} (input ${inscription.input})`;
  const body = inscription.text ?? inscription.hex;
  if (body === undefined) {
    return inscription.size > 0
      ? [head, "  body too big to print, read it from the witness"]
      : [head];
  }
  return [head, ...body.split("\n").map((line) => `  ${line}`)];
}

/* One transaction, a party line only for a party the explorer names. */
/* oxlint-disable-next-line typescript/prefer-readonly-parameter-types */
function describeTransaction(name: string, tx: Readonly<Transaction>): string[] {
  return [
    `[${name}] Tx ${tx.hash}`,
    `Block: ${tx.blockNumber} | Status: ${tx.status}`,
    ...(tx.fee ? [`Fee: ${tx.fee} base units`] : []),
    ...(tx.from ? [`From: ${tx.from}`] : []),
    ...(tx.to ? [`To: ${tx.to}`] : []),
    ...(tx.createdContract ? [`Created contract: ${tx.createdContract}`] : []),
    `Value: ${tx.valueFormatted}`,
    ...(tx.functionName ? [`Method: ${tx.functionName}`] : []),
    ...(tx.tokenTransfers.length > 0 ? [`Token transfers: ${tx.tokenTransfers.length}`] : []),
    ...(tx.opReturn ?? []).flatMap(describeOpReturn),
    ...(tx.inscriptions ?? []).flatMap(describeInscription),
  ];
}

/* A history row: `?` stands in for a party the explorer doesn't name. */
/* oxlint-disable-next-line typescript/prefer-readonly-parameter-types */
function describeHistoryRow(tx: Readonly<Transaction>): string {
  return `  ${tx.hash} ${tx.from || "?"}→${tx.to || "?"} ${tx.valueFormatted} [${tx.status}]`;
}

/* One output per line: the outpoint, its value, and the block that funded it. */
function describeUtxo(utxo: Readonly<Utxo>): string {
  const position = utxo.confirmed ? `block ${utxo.blockNumber ?? "unknown"}` : "pending";
  return `  ${utxo.txid}:${utxo.vout}  ${utxo.valueFormatted} (${utxo.value} base units)  [${position}]`;
}

/* A null key is two different answers, so the line says which one. */
function describePubkey(name: string, reveal: Readonly<PubkeyReveal>): string {
  const head = `[${name}] ${reveal.address} on ${reveal.chain}`;
  if (reveal.pubkey !== null) {
    const shown = reveal.source === "output" ? "taproot output key, paid in" : "shown by spend";
    return `${head}: pubkey ${reveal.pubkey} (${shown} ${reveal.txid ?? "unknown"})`;
  }
  if (!reveal.spent) return `${head}: no pubkey shown, the address never spent`;
  return `${head}: spent, but no key read: a script this read doesn't parse, or a spend older than the history it reads (1000 transactions, 250 on Pepecoin)`;
}

function describeContract(name: string, info: Readonly<ContractInfo>): string[] {
  return [
    `[${name}] Contract ${info.address}`,
    `Verified: ${info.isVerified}`,
    ...(info.name ? [`Name: ${info.name}`] : []),
    ...(info.compilerVersion ? [`Compiler: ${info.compilerVersion}`] : []),
    ...(info.isProxy ? [`Proxy → ${info.implementationAddress ?? "unknown"}`] : []),
    ...(info.isToken ? ["Is token: yes"] : []),
    ...(info.creator ? [`Creator: ${info.creator}`] : []),
  ];
}

function describeHolding(token: Readonly<TokenBalance>): string {
  const usd = token.valueUsd ? ` ($${token.valueUsd.toFixed(2)})` : "";
  return `  ${token.symbol}: ${token.balanceFormatted}${usd}  [${token.contract}]`;
}

function describeTransfer(transfer: Readonly<TokenTransfer>): string {
  return `  ${transfer.txHash} ${transfer.from}→${transfer.to} ${transfer.valueFormatted} ${transfer.symbol}`;
}

function describeGas(name: string, gas: Readonly<GasData>): string[] {
  const prices: Array<[string, string | undefined]> = [
    ["Safe", gas.safeGasPrice],
    ["Average", gas.proposedGasPrice],
    ["Priority", gas.priorityFee],
    ["Fast", gas.fastGasPrice],
    ["Base fee", gas.baseFee],
  ];
  return [
    `[${name}] Gas on ${gas.chain}:`,
    ...prices.flatMap(([label, price]) => (price ? [`  ${label}: ${price} ${gas.unit}`] : [])),
  ];
}

function describeBlock(name: string, block: Readonly<BlockInfo>): string[] {
  return [
    `[${name}] Block #${block.number}`,
    `Hash: ${block.hash}`,
    `Timestamp: ${block.timestamp}`,
    `Miner: ${block.miner}`,
    `Gas used/limit: ${block.gasUsed} / ${block.gasLimit}`,
    `Transactions: ${block.txCount}`,
    ...(block.baseFee ? [`Base fee per gas: ${block.baseFee}`] : []),
  ];
}

/* Supported operations, declared chains, and the public endpoint of one provider. */
function describeProvider(listing: Readonly<ProviderListing>): string {
  const operations =
    listing.capabilities === undefined
      ? "capabilities not declared"
      : Object.entries(listing.capabilities)
          .filter(([, supported]) => supported)
          .map(([capability]) => capability)
          .join(", ") || "no supported explorer operations";
  const chains = listing.chains.join(", ") || "none";
  const endpoint = listing.defaultUrl === undefined ? "" : `; endpoint: ${listing.defaultUrl}`;
  return `  ${listing.name}: ${operations}; chains: ${chains}${endpoint}`;
}

/* `details` of each tool as its executor typed them. */
interface DetailsByTool {
  explorers_providers: ProvidersDetails;
  explorers_balance: ProviderDetails<Balance | Balance[]>;
  explorers_tx_history: ProviderDetails<Transaction[]>;
  explorers_tx_detail: ProviderDetails<Transaction>;
  explorers_utxos: UtxoDetails;
  explorers_pubkey: ProviderDetails<PubkeyReveal>;
  explorers_contract: ProviderDetails<ContractInfo>;
  explorers_tokens: ListedDetails<TokenBalance>;
  explorers_token_transfers: ProviderDetails<TokenTransfer[]>;
  explorers_gas: ProviderDetails<GasData>;
  explorers_block: ProviderDetails<BlockInfo>;
}

type Describers = {
  readonly [Name in keyof DetailsByTool]: (details: Readonly<DetailsByTool[Name]>) => string[];
};

const describers: Describers = {
  explorers_providers: ({ providers }) => [
    `Registered providers (${providers.length}):`,
    ...providers.map(describeProvider),
  ],
  explorers_balance: ({ provider, data }) =>
    (Array.isArray(data) ? data : [data]).map((balance) => describeBalance(provider, balance)),
  explorers_tx_history: ({ provider, data }) => [
    `[${provider}] ${data.length} transactions:`,
    ...data.map(describeHistoryRow),
  ],
  explorers_tx_detail: ({ provider, data }) => describeTransaction(provider, data),
  explorers_utxos: ({ provider, data, total, confirmed, pending }) => [
    `[${provider}] ${total} unspent outputs, ${confirmed} base units confirmed${pending > 0 ? `, ${pending} pending` : ""}${listedCount(data.length, total)}:`,
    ...data.map(describeUtxo),
  ],
  explorers_pubkey: ({ provider, data }) => [describePubkey(provider, data)],
  explorers_contract: ({ provider, data }) => describeContract(provider, data),
  explorers_tokens: ({ provider, data, total }) => [
    `[${provider}] ${total} tokens${listedCount(data.length, total)}:`,
    ...data.map(describeHolding),
  ],
  explorers_token_transfers: ({ provider, data }) => [
    `[${provider}] ${data.length} token transfers:`,
    ...data.map(describeTransfer),
  ],
  explorers_gas: ({ provider, data }) => describeGas(provider, data),
  explorers_block: ({ provider, data }) => describeBlock(provider, data),
};

/**
 * The lines a terminal shows for one answer, unsanitized: the host renderer cleans each one.
 *
 * @param name - Tool that answered.
 * @param details - Its `details`, as its executor returned them.
 * @returns {string[]} The lines, empty for a tool without a describer or a result without details.
 */
export function describeResult(name: string, details: unknown): string[] {
  if (!Object.hasOwn(describers, name) || typeof details !== "object" || details === null)
    return [];
  /* The executor of `name` returned these details, so its own describer reads them. */
  const describe = describers[name as keyof Describers] as (value: unknown) => string[];
  return describe(details);
}

/** Breaks inside one composed line, which would let a field pose as the next one. */
const LINE_BREAKS = /[\n\r]/gu;

/** Lines a collapsed result shows before it points at the rest. */
const COLLAPSED_LINES = 8;

/** What a Pi or OMP result renderer receives, as far as these lines read it. */
export interface RenderedResult {
  readonly content: readonly Readonly<{ type: string; text?: string }>[];
  readonly details?: unknown;
}

/**
 * The lines a terminal draws for one result, each on one line with nothing a terminal would obey.
 * Indents, tabs and joined emoji stay, so an inscription body still reads as written.
 * A result without details, a failure, shows its own text instead.
 *
 * @param name - Tool that answered.
 * @param view - The result and whether the host shows it expanded.
 * @returns {string[]} The lines to draw, cut to a few with a note unless expanded.
 */
export function terminalLines(
  name: string,
  view: Readonly<{ result: RenderedResult; expanded: boolean }>,
): string[] {
  const described = describeResult(name, view.result.details);
  const lines =
    described.length > 0
      ? described
      : view.result.content.flatMap((part) => (part.text ?? "").split("\n"));
  const clean = lines.map((line) => sanitizeText(line.replaceAll(LINE_BREAKS, " ")));
  if (view.expanded || clean.length <= COLLAPSED_LINES) return clean;
  const hidden = clean.length - COLLAPSED_LINES;
  return [...clean.slice(0, COLLAPSED_LINES), `  ... ${hidden} more lines, expand to see them`];
}
