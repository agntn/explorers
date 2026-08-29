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
import { getEsploraAddressHistory } from "../core/esplora.js";
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
  chain_stats: {
    funded_txo_sum: number | string;
    spent_txo_sum: number | string;
  };
}

interface EsploraAddressTx {
  txid: string;
  vin: Array<{
    prevout: {
      scriptpubkey_address?: string;
      value: number;
    } | null;
  }>;
  vout: Array<{
    scriptpubkey_address?: string;
    value: number;
  }>;
  fee: number;
  status: {
    confirmed: boolean;
    block_height?: number;
    block_time?: number;
  };
}

interface EsploraBlock {
  id: string;
  height: number;
  timestamp: number;
  tx_count: number;
  size: number;
  weight: number;
  previousblockhash: string;
}

/** Convert satoshis to BTC without crossing the floating-point boundary. */
function satToBitcoin(satoshis: number | bigint): string {
  return formatWei(String(satoshis), 8);
}

function mapAddressTx(raw: EsploraAddressTx, address: string): Transaction {
  const totalIn = raw.vin
    .filter((input) => input.prevout?.scriptpubkey_address === address)
    .reduce((sum, input) => sum + (input.prevout?.value ?? 0), 0);
  const totalOut = raw.vout
    .filter((output) => output.scriptpubkey_address === address)
    .reduce((sum, output) => sum + output.value, 0);
  const netSatoshis = totalOut - totalIn;
  const isSend = totalIn > 0;
  const transferredSatoshis = isSend ? Math.max(0, Math.abs(netSatoshis) - raw.fee) : netSatoshis;
  const from = isSend
    ? (raw.vin.find((input) => input.prevout?.scriptpubkey_address === address)?.prevout
        ?.scriptpubkey_address ?? address)
    : (raw.vin[0]?.prevout?.scriptpubkey_address ?? "unknown");
  const to = isSend
    ? (raw.vout.find((output) => output.scriptpubkey_address !== address)?.scriptpubkey_address ??
      address)
    : address;

  return {
    hash: raw.txid,
    blockNumber: raw.status.block_height ?? 0,
    timestamp: raw.status.block_time
      ? new Date(raw.status.block_time * 1000).toISOString()
      : undefined,
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

  constructor(config: ProviderConfig) {
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
    options?: TxHistoryOptions,
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
    const totalOut = transaction.vout.reduce((sum, output) => sum + output.value, 0);

    return {
      hash: transaction.txid,
      blockNumber: transaction.status.block_height ?? 0,
      timestamp: transaction.status.block_time
        ? new Date(transaction.status.block_time * 1000).toISOString()
        : undefined,
      from: transaction.vin[0]?.prevout?.scriptpubkey_address ?? "unknown",
      to: transaction.vout[0]?.scriptpubkey_address ?? null,
      value: totalOut.toString(),
      valueFormatted: satToBitcoin(totalOut),
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
