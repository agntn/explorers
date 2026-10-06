/**
 * Mempool.space provider for Bitcoin and compatible forks serving Litecoin and Pepecoin.
 *
 * Public API, no key needed. All three serve address balances and transactions. Litecoin also
 * carries the fee and block endpoints, while Pepecoin does not expose enough data for those reads.
 *
 * https://mempool.space/docs/api
 */

import type {
  ProviderCapabilities,
  ProviderConfig,
  ChainKey,
  Balance,
  Transaction,
  TxHistoryOptions,
  GasData,
  GasUnit,
  BlockInfo,
  TxStatus,
  TokenTransfer,
  PubkeyReveal,
  Utxo,
} from "../core/types.ts";
import { Provider } from "../core/provider.ts";
import { normalizeBaseUrl } from "../core/client.ts";
import { NotFoundError, UnsupportedChainError, UnsupportedOperationError } from "../core/errors.ts";
import { create as createChain } from "@agntn/chains";
import { formatWei, historyPage } from "../core/types.ts";
import { assertSafePathSegment } from "../core/path-safety.ts";
import { collectInscriptions, collectOpReturns } from "../core/script.ts";
import {
  ESPLORA_HISTORY_ROWS,
  esploraFeedAddress,
  getEsploraAddressHistory,
  getEsploraPubkey,
  getEsploraUtxos,
  selectEsploraRecipientOutput,
} from "../core/esplora.ts";
import type {
  EsploraAddressStats,
  EsploraKeyTransaction,
  EsploraUnspentOutput,
} from "../core/esplora.ts";

const DEFAULT_BASE = "https://mempool.space";

const CHAIN_BASES: Partial<Record<ChainKey, string>> = {
  bitcoin: DEFAULT_BASE,
  litecoin: "https://litecoinspace.org",
  pepecoin: "https://peppool.space",
};

/** Peppool allows 15 requests a minute: a key search there reads the counters and ten pages. */
const PEPPOOL_KEY_ROWS = 250;

/** Fee rates come back in the chain's smallest unit per virtual byte. */
const FEE_UNITS: Partial<Record<ChainKey, GasUnit>> = {
  bitcoin: "sat/vB",
  litecoin: "litoshi/vB",
};

interface MempoolAddressSummary {
  readonly address: string;
  readonly chain_stats: {
    readonly funded_txo_count: number;
    readonly funded_txo_sum: number | string;
    readonly spent_txo_count: number;
    readonly spent_txo_sum: number | string;
    readonly tx_count: number;
  };
  readonly mempool_stats?: {
    readonly funded_txo_count: number;
    readonly funded_txo_sum: number | string;
    readonly spent_txo_count: number;
    readonly spent_txo_sum: number | string;
    readonly tx_count: number;
  };
}

interface MempoolTx {
  readonly txid: string;
  readonly version: number;
  readonly locktime: number;
  readonly vin: ReadonlyArray<{
    readonly txid: string;
    readonly vout: number;
    readonly prevout: {
      readonly scriptpubkey: string;
      readonly scriptpubkey_asm: string;
      readonly scriptpubkey_type: string;
      readonly scriptpubkey_address?: string;
      readonly value: number | string;
    } | null;
    readonly scriptsig: string;
    readonly sequence: number;
    readonly witness?: readonly string[];
  }>;
  readonly vout: ReadonlyArray<{
    readonly scriptpubkey: string;
    readonly scriptpubkey_asm: string;
    readonly scriptpubkey_type: string;
    readonly scriptpubkey_address?: string;
    readonly value: number | string;
  }>;
  readonly size: number;
  readonly weight: number;
  readonly fee: number | string;
  readonly status: {
    readonly confirmed: boolean;
    readonly block_height?: number;
    readonly block_hash?: string;
    readonly block_time?: number;
  };
}

interface MempoolAddressTx {
  readonly txid: string;
  readonly version: number;
  readonly locktime: number;
  readonly vin: ReadonlyArray<{
    readonly txid: string;
    readonly vout: number;
    readonly prevout: {
      readonly scriptpubkey_address?: string;
      readonly value: number | string;
    } | null;
    readonly scriptsig: string;
    readonly sequence: number;
  }>;
  readonly vout: ReadonlyArray<{
    readonly scriptpubkey?: string;
    readonly scriptpubkey_type: string;
    readonly scriptpubkey_address?: string;
    readonly value: number | string;
  }>;
  readonly size: number;
  readonly weight: number;
  readonly fee: number | string;
  readonly status: {
    readonly confirmed: boolean;
    readonly block_height?: number;
    readonly block_time?: number;
  };
}

interface MempoolFees {
  readonly fastestFee: number;
  readonly halfHourFee: number;
  readonly hourFee: number;
  readonly economyFee: number;
  readonly minimumFee: number;
}

interface MempoolBlock {
  readonly id: string;
  readonly height: number;
  readonly version: number;
  readonly timestamp: number;
  readonly bits: number;
  readonly nonce: number;
  readonly difficulty: number;
  readonly merkle_root: string;
  readonly tx_count: number;
  readonly size: number;
  readonly weight: number;
  readonly previousblockhash: string;
  readonly mediantime: number;
}

/* Convert the smallest unit to a coin string without floating-point arithmetic. */
function satToCoin(sat: number | string | bigint): string {
  return formatWei(String(sat), 8);
}

function mempoolTimestamp(status: Readonly<MempoolAddressTx["status"]>): string | undefined {
  return status.block_time ? new Date(status.block_time * 1000).toISOString() : undefined;
}

function peppoolHistoryPath(encodedAddress: string, encodedCursor: string): string {
  return `/api/address/${encodedAddress}/txs?after_txid=${encodedCursor}`;
}

function mempoolAddressTotals(
  raw: Readonly<MempoolAddressTx>,
  address: string,
): { readonly input: bigint; readonly output: bigint } {
  const feedAddress = esploraFeedAddress(address);
  const input = raw.vin
    .filter((item) => item.prevout?.scriptpubkey_address === feedAddress)
    .reduce((sum, item) => sum + BigInt(item.prevout?.value ?? 0), 0n);
  const output = raw.vout
    .filter((item) => item.scriptpubkey_address === feedAddress)
    .reduce((sum, item) => sum + BigInt(item.value), 0n);
  return { input, output };
}

function mempoolSendingParties(
  raw: Readonly<MempoolAddressTx>,
  address: string,
): { readonly from: string; readonly to: string } {
  const feedAddress = esploraFeedAddress(address);
  const recipient = selectEsploraRecipientOutput(raw.vout, feedAddress).address;
  return {
    from: address,
    to: recipient === null || recipient === feedAddress ? address : recipient,
  };
}

function mempoolAddressParties(
  raw: Readonly<MempoolAddressTx>,
  address: string,
  isSend: boolean,
): { readonly from: string; readonly to: string } {
  if (isSend) return mempoolSendingParties(raw, address);
  return { from: raw.vin[0]?.prevout?.scriptpubkey_address ?? "unknown", to: address };
}

function mapTx(raw: Readonly<MempoolAddressTx>, address: string): Transaction {
  const totals = mempoolAddressTotals(raw, address);
  const netSat = totals.output - totals.input;
  const isSend = totals.input > 0n;
  const absoluteNetSat = netSat < 0n ? -netSat : netSat;
  const amount = isSend ? absoluteNetSat - BigInt(raw.fee) : netSat;
  const transferredSat = amount < 0n ? 0n : amount;
  const { from, to } = mempoolAddressParties(raw, address, isSend);

  return {
    hash: raw.txid,
    blockNumber: raw.status.block_height ?? 0,
    timestamp: mempoolTimestamp(raw.status),
    from,
    to: to ?? null,
    value: transferredSat.toString(),
    valueFormatted: satToCoin(transferredSat),
    fee: raw.fee.toString(),
    status: (raw.status.confirmed ? "success" : "pending") as TxStatus,
    isContractInteraction: false,
    tokenTransfers: [] as TokenTransfer[],
    opReturn: collectOpReturns(raw.vout.map((output) => output.scriptpubkey)),
    raw: raw as unknown as Record<string, unknown>,
  };
}

export class Mempool extends Provider {
  static readonly key = "mempool";

  private baseUrl: string | undefined;
  private defaultChain: ChainKey;

  constructor(config: Readonly<ProviderConfig>) {
    super(config);
    this.baseUrl = config.baseUrl ? normalizeBaseUrl(config.baseUrl) : undefined;
    this.defaultChain = config.defaultChain ?? "bitcoin";
  }
  get capabilities(): ProviderCapabilities {
    return {
      balances: true,
      txHistory: true,
      txDetail: true,
      utxos: true,
      pubkeys: true,
      contractInfo: false,
      tokenBalances: false,
      tokenTransfers: false,
      gasData: true,
      blockInfo: true,
    };
  }

  /* Chain membership decides support; an explicit `baseUrl` then overrides the host. */
  private base(chain: ChainKey): string {
    const base = CHAIN_BASES[chain];
    if (!base) throw new UnsupportedChainError(chain, "mempool");
    return this.baseUrl ?? base;
  }

  private async api<T>(chain: ChainKey, path: string): Promise<T> {
    return this.getJSON<T>(`${this.base(chain)}${path}`);
  }

  async getBalance(address: string, chain?: ChainKey): Promise<Balance> {
    const c = chain ?? this.defaultChain;

    assertSafePathSegment(address, "address");
    const data = await this.api<MempoolAddressSummary>(
      c,
      `/api/address/${encodeURIComponent(address)}`,
    );

    const fundedSat = BigInt(data.chain_stats.funded_txo_sum);
    const spentSat = BigInt(data.chain_stats.spent_txo_sum);
    const balanceSat = fundedSat - spentSat;

    const unconfirmed = data.mempool_stats
      ? BigInt(data.mempool_stats.funded_txo_sum) - BigInt(data.mempool_stats.spent_txo_sum)
      : undefined;

    return this.snapshotBalance({
      ...(unconfirmed === undefined ? {} : { unconfirmed: unconfirmed.toString() }),
      address,
      chain: c,
      balance: balanceSat.toString(),
      balanceFormatted: satToCoin(balanceSat),
      funded: fundedSat.toString(),
      spent: spentSat.toString(),
      symbol: createChain(c).symbol,
    });
  }

  async getTxHistory(
    address: string,
    chain?: ChainKey,
    options?: Readonly<TxHistoryOptions>,
  ): Promise<Transaction[]> {
    const c = chain ?? this.defaultChain;
    const transactions = await getEsploraAddressHistory(
      address,
      historyPage(options, ESPLORA_HISTORY_ROWS, this.name),
      async (path) => this.api<MempoolAddressTx[]>(c, path),
      c === "pepecoin" ? peppoolHistoryPath : undefined,
    );

    return transactions.map((tx) => mapTx(tx, address));
  }

  override async getUtxos(address: string, chain?: ChainKey): Promise<Utxo[]> {
    const c = chain ?? this.defaultChain;
    return getEsploraUtxos(address, async (path) => this.api<EsploraUnspentOutput[]>(c, path));
  }

  override async getPubkey(address: string, chain?: ChainKey): Promise<PubkeyReveal> {
    const c = chain ?? this.defaultChain;
    const reveal = await getEsploraPubkey(
      address,
      async () => this.api<EsploraAddressStats>(c, `/api/address/${encodeURIComponent(address)}`),
      async (path) => this.api<EsploraKeyTransaction[]>(c, path),
      c === "pepecoin" ? peppoolHistoryPath : undefined,
      c === "pepecoin" ? PEPPOOL_KEY_ROWS : undefined,
    );
    return { ...reveal, chain: c };
  }

  override async getTxDetail(hash: string, chain?: ChainKey): Promise<Transaction> {
    const c = chain ?? this.defaultChain;

    assertSafePathSegment(hash, "tx hash");
    const data = await this.api<MempoolTx>(c, `/api/tx/${encodeURIComponent(hash)}`);

    const output = selectEsploraRecipientOutput(data.vout);
    const fromAddr = data.vin[0]?.prevout?.scriptpubkey_address ?? "unknown";

    return {
      hash: data.txid,
      blockNumber: data.status.block_height ?? 0,
      timestamp: mempoolTimestamp(data.status),
      from: fromAddr,
      to: output.address,
      value: output.value.toString(),
      valueFormatted: satToCoin(output.value),
      fee: data.fee.toString(),
      status: (data.status.confirmed ? "success" : "pending") as TxStatus,
      isContractInteraction: false,
      tokenTransfers: [],
      opReturn: collectOpReturns(data.vout.map((output) => output.scriptpubkey)),
      inscriptions: collectInscriptions(data.vin.map((input) => input.witness)),
      raw: data as unknown as Record<string, unknown>,
    };
  }

  override async getGasData(chain?: ChainKey): Promise<GasData> {
    const c = chain ?? this.defaultChain;
    if (c === "pepecoin") throw new UnsupportedOperationError("getGasData", this.name);

    const fees = await this.api<MempoolFees>(c, "/api/v1/fees/recommended");

    return {
      chain: c,
      unit: FEE_UNITS[c] ?? "sat/vB",
      safeGasPrice: fees.economyFee.toString(),
      proposedGasPrice: fees.halfHourFee.toString(),
      fastGasPrice: fees.fastestFee.toString(),
      priorityFee: fees.minimumFee.toString(),
    };
  }

  override async getBlockInfo(blockNumber: number, chain?: ChainKey): Promise<BlockInfo> {
    const c = chain ?? this.defaultChain;
    if (c === "pepecoin") throw new UnsupportedOperationError("getBlockInfo", this.name);

    assertSafePathSegment(String(blockNumber), "block number");
    const blocks = await this.api<MempoolBlock[]>(
      c,
      `/api/blocks/${encodeURIComponent(String(blockNumber))}`,
    );
    const block = blocks.find((candidate) => candidate.height === blockNumber);
    if (!block) throw new NotFoundError(`Block ${blockNumber}`, "mempool");

    return {
      number: block.height,
      hash: block.id,
      parentHash: block.previousblockhash,
      timestamp: new Date(block.timestamp * 1000).toISOString(),
      miner: "",
      gasUsed: block.size.toString(),
      gasLimit: block.weight.toString(),
      txCount: block.tx_count,
    };
  }
}
