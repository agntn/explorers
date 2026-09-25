/**
 * Blockbook provider, the indexer behind Trezor Suite and the explorer network that serves Bitcoin
 * Gold at btgexplorer.com.
 *
 * Keyless. `baseUrl` is the explorer root, the part before `/api/v2`, `https://btgexplorer.com` by
 * default. Blockbook resolves every input to the address and value it spends, so the sender, the fee
 * and the side an address stands on come from one transaction read, without parent lookups.
 *
 * https://github.com/trezor/blockbook/blob/master/docs/api.md
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

const DEFAULT_BASE = "https://btgexplorer.com";

const DECIMALS = 8;

function assertChain(chain: ChainKey): void {
  if (chain !== "bitcoingold") throw new UnsupportedChainError(chain, Blockbook.key);
}

function assertAddress(address: string): void {
  try {
    getChain("bitcoingold").assertAddress(address);
  } catch {
    throw new ExplorerError("Invalid Bitcoin Gold address", Blockbook.key);
  }
}

function assertTxid(hash: string): void {
  if (!/^[0-9a-fA-F]{64}$/.test(hash))
    throw new ExplorerError("Invalid Bitcoin Gold transaction hash", Blockbook.key);
}

function assertHeight(height: number | undefined, label: string): void {
  if (height !== undefined && (!Number.isSafeInteger(height) || height < 0))
    throw new ExplorerError(`Invalid Bitcoin Gold ${label}`, Blockbook.key);
}

function amount() {
  return z.string().regex(/^\d+$/);
}

function hash() {
  return z.string().regex(/^[0-9a-fA-F]{64}$/);
}

/* Blockbook names a non-standard output by its script (`OP_RETURN aa21…`) and flags it with
   `isAddress: false`, so only flagged entries count as addresses. */
function inputSchema() {
  return z.looseObject({
    addresses: z.array(z.string()).optional(),
    isAddress: z.boolean().optional(),
    value: amount().optional(),
  });
}

function outputSchema() {
  return z.looseObject({
    n: z.number().int().nonnegative(),
    value: amount(),
    addresses: z.array(z.string()).optional(),
    isAddress: z.boolean().optional(),
  });
}

function transactionSchema() {
  return z.looseObject({
    txid: hash(),
    vin: z.array(inputSchema()),
    vout: z.array(outputSchema()),
    blockHeight: z.number().int(),
    confirmations: z.number().int(),
    blockTime: z.number().int().nonnegative().optional(),
    fees: amount().optional(),
  });
}

interface BlockbookEndpoint {
  readonly addresses?: readonly string[];
  readonly isAddress?: boolean;
}

interface BlockbookOutput extends BlockbookEndpoint {
  readonly n: number;
  readonly value: string;
}

interface BlockbookTransaction {
  readonly txid: string;
  readonly vin: readonly BlockbookEndpoint[];
  readonly vout: readonly BlockbookOutput[];
  readonly blockHeight: number;
  readonly confirmations: number;
  readonly blockTime?: number;
  readonly fees?: string;
}

function addressOf(endpoint?: BlockbookEndpoint): string | undefined {
  return endpoint?.isAddress ? endpoint.addresses?.[0] : undefined;
}

function touches(endpoint: BlockbookEndpoint, address: string): boolean {
  return Boolean(endpoint.isAddress && endpoint.addresses?.includes(address));
}

function sum(outputs: readonly { readonly value: string }[]): bigint {
  return outputs.reduce((total, output) => total + BigInt(output.value), 0n);
}

/*
 * Pair a transaction with one transfer. Seen from an address, it is a send when one of its inputs
 * spent from that address, and the value is what went to everyone else; otherwise it is what the
 * address received. Without an address, the first output that pays anyone carries the value.
 */
function transfer(
  tx: BlockbookTransaction,
  address?: string,
): { readonly from: string; readonly to: string | null; readonly value: bigint } {
  const sender = addressOf(tx.vin[0]) ?? "";
  const payments = tx.vout.filter((output) => addressOf(output) !== undefined);

  if (address === undefined) {
    const first = payments[0];
    return { from: sender, to: addressOf(first) ?? null, value: first ? BigInt(first.value) : 0n };
  }

  if (tx.vin.some((input) => touches(input, address))) {
    const others = payments.filter((output) => !touches(output, address));
    return { from: address, to: addressOf(others[0]) ?? address, value: sum(others) };
  }

  return {
    from: sender,
    to: address,
    value: sum(tx.vout.filter((output) => touches(output, address))),
  };
}

function mapTransaction(tx: BlockbookTransaction, address?: string): Transaction {
  const confirmed = tx.confirmations > 0;
  const { from, to, value } = transfer(tx, address);
  return {
    hash: tx.txid,
    blockNumber: confirmed ? tx.blockHeight : 0,
    ...(tx.blockTime ? { timestamp: toTimestamp(tx.blockTime) } : {}),
    from,
    to,
    value: value.toString(),
    valueFormatted: formatWei(value, DECIMALS),
    ...(tx.fees === undefined ? {} : { fee: tx.fees }),
    status: confirmed ? "success" : "pending",
    isContractInteraction: false,
    tokenTransfers: [],
    raw: tx as unknown as Record<string, unknown>,
  };
}

/* Blockbook answers a page past the end with the last page, so the page it names is compared. */
function historyWindow(options: Readonly<TxHistoryOptions> = {}) {
  if (options.sort === "asc")
    throw new ExplorerError("Blockbook lists history newest first only", Blockbook.key);
  assertHeight(options.startBlock, "start block");
  assertHeight(options.endBlock, "end block");
  const page = options.page ?? 1;
  if (!Number.isSafeInteger(page) || page < 1)
    throw new ExplorerError("Blockbook history pages start at 1", Blockbook.key);
  return {
    page,
    pageSize: clampMaxResults(options.limit),
    from: options.startBlock,
    to: options.endBlock,
  };
}

/* The reason Blockbook gives in the `error` field of a 400 body. */
function errorReason(body: string | undefined): string | undefined {
  if (body === undefined) return undefined;
  try {
    const parsed = JSON.parse(body) as { error?: unknown } | null;
    const reason = parsed?.error;
    return typeof reason === "string" && reason !== "" ? reason : undefined;
  } catch {
    return undefined;
  }
}

export class Blockbook extends Provider {
  static readonly key = "blockbook";

  private readonly baseUrl: string;

  constructor(config: Readonly<ProviderConfig> = {}) {
    super(config);
    this.baseUrl = normalizeBaseUrl(config.baseUrl ?? DEFAULT_BASE);
  }

  /* `/api/v2/estimatefee` quotes coins per kilobyte from the node, a unit no other provider here
     speaks, so gas stays unsupported rather than converted into something that looks like `sat/vB`. */
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

  /* Blockbook answers a missing object or a rejected argument with HTTP 400 and the reason in an
     `error` field, so a missing transaction reads as `NotFoundError` rather than a bare 400. */
  private async read(path: string, resource: string): Promise<unknown> {
    try {
      return await this.getJSON<unknown>(`${this.baseUrl}/api/v2${path}`);
    } catch (error) {
      if (!(error instanceof HTTPError) || error.statusCode !== 400) throw error;
      const reason = errorReason(error.body);
      if (reason === undefined) throw error;
      if (/not found/i.test(reason)) throw new NotFoundError(resource, Blockbook.key);
      throw new ExplorerError(`Blockbook: ${reason}`, Blockbook.key);
    }
  }

  async getBalance(address: string, chain: ChainKey = "bitcoingold"): Promise<Balance> {
    assertChain(chain);
    assertAddress(address);
    const parsed = z
      .looseObject({
        balance: amount(),
        totalReceived: amount(),
        totalSent: amount(),
        unconfirmedBalance: z.string().regex(/^-?\d+$/),
      })
      .safeParse(
        await this.read(
          `/address/${encodeURIComponent(address)}${buildQuery({ details: "basic" })}`,
          `Address ${address}`,
        ),
      );
    if (!parsed.success)
      throw new ExplorerError("Unexpected Blockbook address response", Blockbook.key);
    const data = parsed.data;
    return this.snapshotBalance({
      address,
      chain,
      balance: data.balance,
      balanceFormatted: formatWei(data.balance, DECIMALS),
      funded: data.totalReceived,
      spent: data.totalSent,
      unconfirmed: data.unconfirmedBalance,
      symbol: "BTG",
    });
  }

  async getTxHistory(
    address: string,
    chain: ChainKey = "bitcoingold",
    options?: Readonly<TxHistoryOptions>,
  ): Promise<Transaction[]> {
    assertChain(chain);
    assertAddress(address);
    const window = historyWindow(options);
    const parsed = z
      .looseObject({
        page: z.number().int(),
        transactions: z.array(transactionSchema()).optional(),
      })
      .safeParse(
        await this.read(
          `/address/${encodeURIComponent(address)}${buildQuery({ details: "txs", ...window })}`,
          `Address ${address}`,
        ),
      );
    if (!parsed.success)
      throw new ExplorerError("Unexpected Blockbook history response", Blockbook.key);
    if (parsed.data.page !== window.page) return [];
    return (parsed.data.transactions ?? []).map((tx) => mapTransaction(tx, address));
  }

  override async getTxDetail(hash: string, chain: ChainKey = "bitcoingold"): Promise<Transaction> {
    assertChain(chain);
    assertTxid(hash);
    const parsed = transactionSchema().safeParse(
      await this.read(`/tx/${encodeURIComponent(hash)}`, `Transaction ${hash}`),
    );
    if (!parsed.success)
      throw new ExplorerError("Unexpected Blockbook transaction response", Blockbook.key);
    return mapTransaction(parsed.data);
  }

  override async getUtxos(address: string, chain: ChainKey = "bitcoingold"): Promise<Utxo[]> {
    assertChain(chain);
    assertAddress(address);
    const parsed = z
      .array(
        z.looseObject({
          txid: hash(),
          vout: z.number().int().nonnegative(),
          value: amount(),
          height: z.number().int().optional(),
          confirmations: z.number().int(),
        }),
      )
      .safeParse(await this.read(`/utxo/${encodeURIComponent(address)}`, `Address ${address}`));
    if (!parsed.success)
      throw new ExplorerError("Unexpected Blockbook unspent response", Blockbook.key);
    return parsed.data.map((output) => {
      const confirmed = output.confirmations > 0 && output.height !== undefined;
      return {
        txid: output.txid,
        vout: output.vout,
        value: output.value,
        valueFormatted: formatWei(output.value, DECIMALS),
        confirmed,
        blockNumber: confirmed ? (output.height ?? null) : null,
        blockHash: null,
      };
    });
  }

  override async getBlockInfo(
    blockNumber: number,
    chain: ChainKey = "bitcoingold",
  ): Promise<BlockInfo> {
    assertChain(chain);
    if (!Number.isSafeInteger(blockNumber) || blockNumber < 0)
      throw new ExplorerError("Invalid Bitcoin Gold block height", Blockbook.key);
    const parsed = z
      .looseObject({
        hash: hash(),
        height: z.number().int().nonnegative(),
        time: z.number().int().nonnegative(),
        txCount: z.number().int().nonnegative(),
        previousBlockHash: z.string().optional(),
      })
      .safeParse(await this.read(`/block/${blockNumber}`, `Block ${blockNumber}`));
    if (!parsed.success)
      throw new ExplorerError("Unexpected Blockbook block response", Blockbook.key);
    const block = parsed.data;
    if (block.height !== blockNumber)
      throw new NotFoundError(`Block ${blockNumber}`, Blockbook.key);
    return {
      number: block.height,
      hash: block.hash,
      parentHash: block.previousBlockHash ?? "",
      timestamp: toTimestamp(block.time),
      miner: "",
      gasUsed: "0",
      gasLimit: "0",
      txCount: block.txCount,
    };
  }
}
