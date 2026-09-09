import { getChain } from "@agntn/chains";
import { z } from "zod";
import { Provider } from "../core/provider.js";
import { normalizeBaseUrl } from "../core/client.js";
import { DCRDATA_INSIGHT_URL } from "../core/endpoints.js";
import { ExplorerError, UnsupportedChainError } from "../core/errors.js";
import { formatWei } from "../core/types.js";
import type {
  Balance,
  BlockInfo,
  ChainKey,
  ProviderCapabilities,
  ProviderConfig,
  Transaction,
  TxHistoryOptions,
} from "../core/types.js";

function assertChain(chain: ChainKey): void {
  if (chain !== "decred") throw new UnsupportedChainError(chain, Dcrdata.key);
}

function assertAddress(address: string): void {
  try {
    getChain("decred").assertAddress(address);
  } catch {
    throw new ExplorerError("Invalid Decred mainnet address", Dcrdata.key);
  }
}

function hashSchema() {
  return z.string().regex(/^[a-fA-F0-9]{64}$/);
}

function addressTextSchema() {
  return z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{1,54}$/);
}

function transactionSchema() {
  return z
    .object({
      txid: hashSchema(),
      blockheight: z.number().int().safe(),
      confirmations: z.number().int().safe(),
      blocktime: z.number().int().nonnegative().max(8_640_000_000_000).optional(),
      time: z.number().int().nonnegative().max(8_640_000_000_000).optional(),
      fees: z.number().optional(),
      isCoinBase: z.boolean().optional(),
      isTreasurybase: z.boolean().optional(),
      vin: z.array(
        z
          .object({
            addr: addressTextSchema().optional(),
          })
          .passthrough(),
      ),
      vout: z.array(
        z
          .object({
            value: z.number().nonnegative().max(21_000_000),
            scriptPubKey: z
              .object({
                addresses: z.array(addressTextSchema()).nullish(),
                hex: z
                  .string()
                  .regex(/^(?:[a-fA-F0-9]{2})*$/)
                  .optional(),
                type: z.string().optional(),
              })
              .passthrough(),
          })
          .passthrough(),
      ),
    })
    .passthrough();
}

type InsightTransaction = z.infer<ReturnType<typeof transactionSchema>>;

/**
 * Convert decimal spelling, including scientific notation, without multiplying floats.
 * @param {number} value - DCR amount returned by Insight.
 * @returns {string} Exact integer atoms.
 */
function dcrToAtoms(value: number): string {
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(String(value));
  if (!match || value > 21_000_000) throw new ExplorerError("Invalid dcrdata amount", Dcrdata.key);
  const fraction = match[2] ?? "";
  const shift = 8 + Number(match[3] ?? 0) - fraction.length;
  if (shift < -16 || shift > 16) throw new ExplorerError("Invalid dcrdata amount", Dcrdata.key);
  const digits = BigInt(`${match[1]}${fraction}`);
  if (shift >= 0) return (digits * 10n ** BigInt(shift)).toString();
  const divisor = 10n ** BigInt(-shift);
  if (digits % divisor !== 0n)
    throw new ExplorerError("Fractional atom in dcrdata amount", Dcrdata.key);
  return (digits / divisor).toString();
}

interface Output {
  readonly value: number;
  readonly scriptPubKey: {
    readonly type?: string;
    readonly hex?: string;
    readonly addresses?: readonly string[] | null;
  };
}

function outputAddress(output?: Output): string {
  return output?.scriptPubKey.addresses?.[0] ?? "";
}

function isAddressedOutput(output: Output): boolean {
  return (
    output.scriptPubKey.type !== "nulldata" &&
    !output.scriptPubKey.hex?.toLowerCase().startsWith("6a") &&
    outputAddress(output) !== ""
  );
}

function selectTransfer(outputs: readonly Output[], address?: string, outgoing = false) {
  const addressed = outputs.filter(isAddressedOutput);
  const preferred =
    address === undefined
      ? undefined
      : addressed.find(
          (output) => Boolean(output.scriptPubKey.addresses?.includes(address)) !== outgoing,
        );
  const selected = preferred ?? addressed[0];
  const to = !outgoing && address && preferred ? address : outputAddress(selected);
  return { to, value: selected === undefined ? "0" : dcrToAtoms(selected.value) };
}

function transactionFee(
  tx: Readonly<Pick<InsightTransaction, "fees" | "isCoinBase" | "isTreasurybase">>,
) {
  if (tx.isCoinBase || tx.isTreasurybase) return { fee: "0" };
  return tx.fees === undefined ? {} : { fee: dcrToAtoms(tx.fees) };
}

function transactionPosition(confirmations: number, height: number, time?: number) {
  const status = confirmations < 0 ? "failed" : confirmations === 0 ? "pending" : "success";
  return {
    status,
    blockNumber: confirmations > 0 ? height : 0,
    ...(time === undefined || time === 0 ? {} : { timestamp: new Date(time * 1000).toISOString() }),
  } as const;
}

/* oxlint-disable-next-line typescript/prefer-readonly-parameter-types */
function mapTransaction(tx: InsightTransaction, address?: string): Transaction {
  const outgoing = address !== undefined && tx.vin.some((input) => input.addr === address);
  const from = (outgoing ? address : tx.vin.find((input) => input.addr)?.addr) ?? "";
  const transfer = selectTransfer(tx.vout, address, outgoing);
  return {
    hash: tx.txid,
    from,
    ...transfer,
    valueFormatted: formatWei(transfer.value, 8),
    ...transactionFee(tx),
    ...transactionPosition(tx.confirmations, tx.blockheight, tx.blocktime ?? tx.time),
    isContractInteraction: false,
    tokenTransfers: [],
    raw: { ...tx },
  };
}

function historyWindow(options: Readonly<TxHistoryOptions>) {
  const limit = options.limit ?? 100;
  const page = options.page ?? 1;
  const parsed = z
    .object({
      limit: z.number().int().min(1).max(250),
      page: z.number().int().positive().safe(),
    })
    .safeParse({ limit, page });
  if (!parsed.success || !Number.isSafeInteger(limit * page))
    throw new ExplorerError(
      "dcrdata history requires limit 1 to 250 and a positive safe page window",
      Dcrdata.key,
    );
  if (options.startBlock !== undefined || options.endBlock !== undefined)
    throw new ExplorerError("dcrdata Insight history does not support block filters", Dcrdata.key);
  return { limit, offset: (page - 1) * limit };
}

/** Decred balances, transactions and blocks from dcrdata's Insight API. */
export class Dcrdata extends Provider {
  static readonly key = "dcrdata";
  private readonly base: string;

  constructor(config: Readonly<ProviderConfig> = {}) {
    super(config);
    this.base = normalizeBaseUrl(config.baseUrl ?? DCRDATA_INSIGHT_URL);
  }

  get capabilities(): ProviderCapabilities {
    return {
      balances: true,
      txHistory: true,
      txDetail: true,
      contractInfo: false,
      tokenBalances: false,
      tokenTransfers: false,
      gasData: false,
      blockInfo: true,
    };
  }

  /**
   * Includes the mempool delta. Received and spent totals cover confirmed activity.
   * @param {string} address - Decred mainnet address.
   * @param {ChainKey} chain - Must be Decred.
   * @returns {Promise<Balance>} Amounts in atoms, with no block snapshot from Insight.
   */
  async getBalance(address: string, chain: ChainKey = "decred"): Promise<Balance> {
    assertChain(chain);
    assertAddress(address);
    const raw = await this.getJSON<unknown>(`${this.base}/addr/${address}?noTxList=1`);
    const atoms = z.union([z.number().int().nonnegative().safe(), z.string().regex(/^\d+$/)]);
    const signedAtoms = z.union([z.number().int().safe(), z.string().regex(/^-?\d+$/)]);
    const parsed = z
      .object({
        addrStr: z.literal(address),
        balanceSat: atoms,
        totalReceivedSat: atoms,
        totalSentSat: atoms,
        unconfirmedBalanceSat: signedAtoms,
      })
      .safeParse(raw);
    if (!parsed.success) throw new ExplorerError("Invalid dcrdata balance response", this.name);
    const data = parsed.data;
    const balance = (BigInt(data.balanceSat) + BigInt(data.unconfirmedBalanceSat)).toString();
    return this.snapshotBalance({
      address,
      chain,
      balance,
      balanceFormatted: formatWei(balance, 8),
      funded: String(data.totalReceivedSat),
      spent: String(data.totalSentSat),
      symbol: "DCR",
    });
  }

  override async getTxDetail(hash: string, chain: ChainKey = "decred"): Promise<Transaction> {
    assertChain(chain);
    if (!hashSchema().safeParse(hash).success)
      throw new ExplorerError("Invalid Decred transaction hash", this.name);
    const raw = await this.getJSON<unknown>(`${this.base}/tx/${hash}`);
    const parsed = transactionSchema().safeParse(raw);
    if (!parsed.success || parsed.data.txid.toLowerCase() !== hash.toLowerCase())
      throw new ExplorerError("Invalid dcrdata transaction response", this.name);
    return mapTransaction(parsed.data);
  }

  private async historyPage(address: string, from: number, to: number) {
    const raw = await this.getJSON<unknown>(
      `${this.base}/addrs/${address}/txs?from=${from}&to=${to}`,
    );
    const parsed = z
      .object({
        totalItems: z.number().int().nonnegative().safe(),
        from: z.number().int().nonnegative().safe(),
        to: z.number().int().nonnegative().safe(),
        items: z.array(transactionSchema()).max(to - from),
      })
      .safeParse(raw);
    if (!parsed.success) throw new ExplorerError("Invalid dcrdata history response", this.name);
    const page = parsed.data;
    const expectedFrom = page.totalItems === 0 ? from : Math.min(from, page.totalItems);
    const expectedTo = page.totalItems === 0 ? to : Math.min(to, page.totalItems);
    if (
      page.from !== expectedFrom ||
      page.to !== expectedTo ||
      page.items.length !== Math.max(0, Math.min(to, page.totalItems) - from)
    )
      throw new ExplorerError("Incomplete dcrdata history page", this.name);
    return page;
  }

  async getTxHistory(
    address: string,
    chain: ChainKey = "decred",
    options: Readonly<TxHistoryOptions> = {},
  ): Promise<Transaction[]> {
    assertChain(chain);
    assertAddress(address);
    const { limit, offset } = historyWindow(options);
    if (options.sort !== "asc") {
      const result = await this.historyPage(address, offset, offset + limit);
      return result.items.map((tx) => mapTransaction(tx, address));
    }
    const first = await this.historyPage(address, 0, 1);
    const to = Math.max(0, first.totalItems - offset);
    if (to === 0) return [];
    const result = await this.historyPage(address, Math.max(0, to - limit), to);
    if (result.totalItems !== first.totalItems)
      throw new ExplorerError("dcrdata history changed while paging; retry the read", this.name);
    return result.items.reverse().map((tx) => mapTransaction(tx, address));
  }

  override async getBlockInfo(blockNumber: number, chain: ChainKey = "decred"): Promise<BlockInfo> {
    assertChain(chain);
    if (!Number.isSafeInteger(blockNumber) || blockNumber < 0)
      throw new ExplorerError("Decred block number must be a nonnegative safe integer", this.name);
    const raw = await this.getJSON<unknown>(`${this.base}/block/${blockNumber}`);
    const parsed = z
      .array(
        z.object({
          height: z.literal(blockNumber),
          hash: hashSchema(),
          previousblockhash: hashSchema(),
          time: z.number().int().nonnegative().max(8_640_000_000_000),
          tx: z.array(hashSchema()).optional(),
        }),
      )
      .length(1)
      .safeParse(raw);
    const block = parsed.success ? parsed.data[0] : undefined;
    if (!block) throw new ExplorerError("Invalid dcrdata block response", this.name);
    return {
      number: block.height,
      hash: block.hash,
      parentHash: block.previousblockhash,
      timestamp: new Date(block.time * 1000).toISOString(),
      miner: "",
      gasUsed: "0",
      gasLimit: "0",
      txCount: block.tx?.length ?? 0,
    };
  }
}
