/**
 * Blockstream provider for Bitcoin.
 *
 * Public API, no key needed. The service exposes balances, transactions and blocks through the
 * Esplora wire format at blockstream.info.
 *
 * https://github.com/Blockstream/esplora/blob/master/API.md
 */

import { create as createChain } from "@agntn/chains";
import { NotFoundError, UnsupportedChainError } from "../core/errors.js";
import { assertSafePathSegment } from "../core/path-safety.js";
import { Provider } from "../core/provider.js";
import { normalizeBaseUrl } from "../core/client.js";
import { formatWei } from "../core/types.js";
import { getEsploraAddressHistory, getFirstEsploraOutput } from "../core/esplora.js";
import type {
  Balance,
  BlockInfo,
  ChainKey,
  ProviderCapabilities,
  ProviderConfig,
  TokenTransfer,
  Transaction,
  TxHistoryOptions,
  TxStatus,
} from "../core/types.js";

const DEFAULT_BASE = "https://blockstream.info";

interface EsploraAddressSummary {
  readonly chain_stats: {
    readonly funded_txo_sum: number | string;
    readonly spent_txo_sum: number | string;
  };
}

interface EsploraAddressTx {
  readonly txid: string;
  readonly vin: ReadonlyArray<{
    readonly prevout: {
      readonly scriptpubkey_address?: string;
      readonly value: number;
    } | null;
  }>;
  readonly vout: ReadonlyArray<{
    readonly scriptpubkey_address?: string;
    readonly value: number;
  }>;
  readonly fee: number;
  readonly status: {
    readonly confirmed: boolean;
    readonly block_height?: number;
    readonly block_time?: number;
  };
}

interface EsploraBlock {
  readonly id: string;
  readonly height: number;
  readonly timestamp: number;
  readonly tx_count: number;
  readonly size: number;
  readonly weight: number;
  readonly previousblockhash: string;
}

/* Convert satoshis to BTC without crossing the floating-point boundary. */
function satToBitcoin(satoshis: number | bigint): string {
  return formatWei(String(satoshis), 8);
}

function transactionTimestamp(status: Readonly<EsploraAddressTx["status"]>): string | undefined {
  return status.block_time ? new Date(status.block_time * 1000).toISOString() : undefined;
}

function addressTotals(
  raw: Readonly<EsploraAddressTx>,
  address: string,
): { in: number; out: number } {
  const totalIn = raw.vin
    .filter((input) => input.prevout?.scriptpubkey_address === address)
    .reduce((sum, input) => sum + (input.prevout?.value ?? 0), 0);
  const totalOut = raw.vout
    .filter((output) => output.scriptpubkey_address === address)
    .reduce((sum, output) => sum + output.value, 0);
  return { in: totalIn, out: totalOut };
}

function sendingAddressParties(
  raw: Readonly<EsploraAddressTx>,
  address: string,
): { readonly from: string; readonly to: string } {
  const recipient = raw.vout.find((output) => output.scriptpubkey_address !== address);
  const sender = raw.vin.find((input) => input.prevout?.scriptpubkey_address === address);
  return {
    from: sender?.prevout?.scriptpubkey_address ?? address,
    to: recipient?.scriptpubkey_address ?? address,
  };
}

function addressParties(
  raw: Readonly<EsploraAddressTx>,
  address: string,
  isSend: boolean,
): { readonly from: string; readonly to: string } {
  if (isSend) return sendingAddressParties(raw, address);
  return { from: raw.vin[0]?.prevout?.scriptpubkey_address ?? "unknown", to: address };
}

function mapAddressTx(raw: Readonly<EsploraAddressTx>, address: string): Transaction {
  const totals = addressTotals(raw, address);
  const netSatoshis = totals.out - totals.in;
  const isSend = totals.in > 0;
  const transferredSatoshis = isSend ? Math.max(0, Math.abs(netSatoshis) - raw.fee) : netSatoshis;
  const { from, to } = addressParties(raw, address, isSend);

  return {
    hash: raw.txid,
    blockNumber: raw.status.block_height ?? 0,
    timestamp: transactionTimestamp(raw.status),
    from,
    to,
    value: transferredSatoshis.toString(),
    valueFormatted: satToBitcoin(transferredSatoshis),
    fee: raw.fee.toString(),
    status: (raw.status.confirmed ? "success" : "pending") as TxStatus,
    isContractInteraction: false,
    tokenTransfers: [] as TokenTransfer[],
    raw: raw as unknown as Record<string, unknown>,
  };
}

export class Blockstream extends Provider {
  static readonly key = "blockstream";

  private readonly baseUrl: string;
  private readonly defaultChain: ChainKey;

  constructor(config: Readonly<ProviderConfig>) {
    super(config);
    this.baseUrl = normalizeBaseUrl(config.baseUrl ?? DEFAULT_BASE);
    this.defaultChain = config.defaultChain ?? "bitcoin";
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

  private api<T>(chain: ChainKey, path: string): Promise<T> {
    if (chain !== "bitcoin") throw new UnsupportedChainError(chain, "blockstream");
    return this.getJSON<T>(`${this.baseUrl}${path}`);
  }

  async getBalance(address: string, chain?: ChainKey): Promise<Balance> {
    const selectedChain = chain ?? this.defaultChain;
    assertSafePathSegment(address, "address");
    const data = await this.api<EsploraAddressSummary>(
      selectedChain,
      `/api/address/${encodeURIComponent(address)}`,
    );
    const fundedSatoshis = BigInt(data.chain_stats.funded_txo_sum);
    const spentSatoshis = BigInt(data.chain_stats.spent_txo_sum);
    const balanceSatoshis = fundedSatoshis - spentSatoshis;

    return this.snapshotBalance({
      address,
      chain: selectedChain,
      balance: balanceSatoshis.toString(),
      balanceFormatted: satToBitcoin(balanceSatoshis),
      funded: fundedSatoshis.toString(),
      spent: spentSatoshis.toString(),
      symbol: createChain(selectedChain).symbol,
    });
  }

  async getTxHistory(
    address: string,
    chain?: ChainKey,
    options?: Readonly<TxHistoryOptions>,
  ): Promise<Transaction[]> {
    const selectedChain = chain ?? this.defaultChain;
    const transactions = await getEsploraAddressHistory(address, options?.limit, async (path) =>
      this.api<EsploraAddressTx[]>(selectedChain, path),
    );

    return transactions.map((transaction) => mapAddressTx(transaction, address));
  }

  override async getTxDetail(hash: string, chain?: ChainKey): Promise<Transaction> {
    const selectedChain = chain ?? this.defaultChain;
    assertSafePathSegment(hash, "tx hash");
    const transaction = await this.api<EsploraAddressTx>(
      selectedChain,
      `/api/tx/${encodeURIComponent(hash)}`,
    );
    const output = getFirstEsploraOutput(transaction.vout);

    return {
      hash: transaction.txid,
      blockNumber: transaction.status.block_height ?? 0,
      timestamp: transactionTimestamp(transaction.status),
      from: transaction.vin[0]?.prevout?.scriptpubkey_address ?? "unknown",
      to: output.address,
      value: output.value.toString(),
      valueFormatted: satToBitcoin(output.value),
      fee: transaction.fee.toString(),
      status: (transaction.status.confirmed ? "success" : "pending") as TxStatus,
      isContractInteraction: false,
      tokenTransfers: [],
      raw: transaction as unknown as Record<string, unknown>,
    };
  }

  override async getBlockInfo(blockNumber: number, chain?: ChainKey): Promise<BlockInfo> {
    const selectedChain = chain ?? this.defaultChain;
    assertSafePathSegment(String(blockNumber), "block number");
    const blocks = await this.api<EsploraBlock[]>(
      selectedChain,
      `/api/blocks/${encodeURIComponent(String(blockNumber))}`,
    );
    const block = blocks.find((candidate) => candidate.height === blockNumber);
    if (!block) throw new NotFoundError(`Block ${blockNumber}`, "blockstream");

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
