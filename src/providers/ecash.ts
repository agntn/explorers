/**
 * eCash Block Explorer, the keyless Bitcoin ABC explorer at explorer.e.cash, serving eCash.
 *
 * Its JSON stops at address history and block ranges. The balance only lives on an HTML page, so
 * `getBalance` throws and Blockchair keeps that read.
 *
 * https://github.com/Bitcoin-ABC/bitcoin-abc/tree/master/web/explorer/explorer-server
 */

import { getChain } from "@agntn/chains";
import { z } from "zod";
import { Provider } from "../core/provider.ts";
import { buildQuery, normalizeBaseUrl } from "../core/client.ts";
import {
  ExplorerError,
  NotFoundError,
  UnsupportedChainError,
  UnsupportedOperationError,
} from "../core/errors.ts";
import { clampMaxResults, formatWei, toTimestamp } from "../core/types.ts";
import type {
  Balance,
  BlockInfo,
  ChainKey,
  ProviderCapabilities,
  ProviderConfig,
  Transaction,
  TxHistoryOptions,
} from "../core/types.ts";

const DEFAULT_BASE = "https://explorer.e.cash";

/* 100 satoshis make one XEC. */
const DECIMALS = 2;

function assertChain(chain: ChainKey): void {
  if (chain !== "ecash") throw new UnsupportedChainError(chain, ECash.key);
}

/* The explorer reads only lowercase `ecash:` CashAddr and answers anything else with a 500. */
function cashAddress(address: string): string {
  try {
    getChain("ecash").assertAddress(address);
  } catch {
    throw new ExplorerError("Invalid eCash address, expected CashAddr", ECash.key);
  }
  const lower = address.toLowerCase();
  return lower.startsWith("ecash:") ? lower : `ecash:${lower}`;
}

/* Satoshi amounts are signed 64-bit integers, and the HTTP client keeps one past 2^53 a string. */
function sats() {
  return z.union([z.number().int(), z.string().regex(/^-?\d+$/)]).transform(BigInt);
}

function hash() {
  return z.string().regex(/^[0-9a-fA-F]{64}$/);
}

/* Seconds a `Date` can hold, so `toTimestamp` can't throw a RangeError on a broken row. */
function seconds() {
  return z.number().int().nonnegative().max(8_640_000_000_000);
}

function historySchema() {
  return z.looseObject({
    data: z.array(
      z.looseObject({
        txHash: hash(),
        blockHeight: z.number().int().nonnegative().nullable(),
        timestamp: seconds(),
        isCoinbase: z.boolean(),
        stats: z.looseObject({ satsInput: sats(), satsOutput: sats(), deltaSats: sats() }),
      }),
    ),
  });
}

interface ECashTransaction {
  readonly txHash: string;
  readonly blockHeight: number | null;
  readonly timestamp: number;
  readonly isCoinbase: boolean;
  readonly stats: Readonly<{ satsInput: bigint; satsOutput: bigint; deltaSats: bigint }>;
}

/* Only the net change is known. Below zero it's a send, and Mempool's rule takes the fee off. */
function transfer(tx: ECashTransaction, address: string, fee: bigint) {
  const delta = tx.stats.deltaSats;
  if (delta >= 0n) return { from: "", to: address, value: delta };
  const sent = -delta - fee;
  return { from: address, to: null, value: sent < 0n ? 0n : sent };
}

/* `raw` is the row as sent, since the parsed one holds bigints that JSON can't serialize. */
function mapTransaction(tx: ECashTransaction, raw: unknown, address: string): Transaction {
  const fee = tx.isCoinbase ? undefined : tx.stats.satsInput - tx.stats.satsOutput;
  const { from, to, value } = transfer(tx, address, fee ?? 0n);
  return {
    hash: tx.txHash,
    blockNumber: tx.blockHeight ?? 0,
    ...(tx.timestamp > 0 ? { timestamp: toTimestamp(tx.timestamp) } : {}),
    from,
    to,
    value: value.toString(),
    valueFormatted: formatWei(value, DECIMALS),
    ...(fee === undefined ? {} : { fee: fee.toString() }),
    status: tx.blockHeight === null ? "pending" : "success",
    isContractInteraction: false,
    tokenTransfers: [],
    raw: raw as Record<string, unknown>,
  };
}

/* Chronik pages run from 0, newest first with the mempool on top. */
function historyWindow(options: Readonly<TxHistoryOptions> = {}) {
  if (options.sort === "asc")
    throw new ExplorerError("eCash Explorer lists history newest first only", ECash.key);
  if (options.startBlock !== undefined || options.endBlock !== undefined)
    throw new ExplorerError("eCash Explorer history takes no block bounds", ECash.key);
  const page = options.page ?? 1;
  if (!Number.isSafeInteger(page) || page < 1)
    throw new ExplorerError("eCash Explorer history pages start at 1", ECash.key);
  return { page: page - 1, take: clampMaxResults(options.limit) };
}

export class ECash extends Provider {
  static readonly key = "ecash";

  private readonly baseUrl: string;

  constructor(config: Readonly<ProviderConfig> = {}) {
    super(config);
    this.baseUrl = normalizeBaseUrl(config.baseUrl ?? DEFAULT_BASE);
  }

  get capabilities(): ProviderCapabilities {
    return {
      balances: false,
      txHistory: true,
      txDetail: false,
      utxos: false,
      pubkeys: false,
      contractInfo: false,
      tokenBalances: false,
      tokenTransfers: false,
      gasData: false,
      blockInfo: true,
    };
  }

  async getBalance(_address: string, chain: ChainKey = "ecash"): Promise<Balance> {
    assertChain(chain);
    throw new UnsupportedOperationError("getBalance", this.name);
  }

  async getTxHistory(
    address: string,
    chain: ChainKey = "ecash",
    options?: Readonly<TxHistoryOptions>,
  ): Promise<Transaction[]> {
    assertChain(chain);
    const canonical = cashAddress(address);
    const response = await this.getJSON<unknown>(
      `${this.baseUrl}/api/address/${encodeURIComponent(canonical)}/transactions${buildQuery(
        historyWindow(options),
      )}`,
    );
    const parsed = historySchema().safeParse(response);
    if (!parsed.success)
      throw new ExplorerError("Unexpected eCash Explorer history response", ECash.key);
    const rows = (response as Readonly<{ data: readonly unknown[] }>).data;
    return parsed.data.data.map((tx, index) => mapTransaction(tx, rows[index], canonical));
  }

  /* Reading the block with the one below it brings the parent hash in the same request. */
  override async getBlockInfo(blockNumber: number, chain: ChainKey = "ecash"): Promise<BlockInfo> {
    assertChain(chain);
    if (!Number.isSafeInteger(blockNumber) || blockNumber < 0)
      throw new ExplorerError("Invalid eCash block height", ECash.key);
    const parsed = z
      .looseObject({
        data: z.array(
          z.looseObject({
            hash: hash(),
            height: z.number().int().nonnegative(),
            timestamp: seconds(),
            numTxs: z.number().int().nonnegative(),
          }),
        ),
      })
      .safeParse(
        await this.getJSON<unknown>(
          `${this.baseUrl}/api/blocks/${Math.max(0, blockNumber - 1)}/${blockNumber}`,
        ),
      );
    if (!parsed.success)
      throw new ExplorerError("Unexpected eCash Explorer block response", ECash.key);
    const block = parsed.data.data.find((entry) => entry.height === blockNumber);
    if (block === undefined) throw new NotFoundError(`Block ${blockNumber}`, ECash.key);
    const parent = parsed.data.data.find((entry) => entry.height === blockNumber - 1);
    return {
      number: block.height,
      hash: block.hash,
      /* Bitcoin's genesis block names an all-zero parent, and eCash kept that block. */
      parentHash: blockNumber === 0 ? "0".repeat(64) : (parent?.hash ?? ""),
      timestamp: toTimestamp(block.timestamp),
      miner: "",
      gasUsed: "0",
      gasLimit: "0",
      txCount: block.numTxs,
    };
  }
}
