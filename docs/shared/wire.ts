/**
 * The shapes the docs worker answers with. `shared/` is visible to both `app/` and `server/`, so
 * the routes build these and the page reads them from one declaration.
 */
import type { Balance, BlockInfo, GasData, TokenBalance, TokenTransfer, Utxo } from "@agntn/explorers";

export type Status = "success" | "failed" | "pending";

/** A `Transaction` without `raw`, its token transfers without the repeated hash. */
export interface WireTransaction {
  hash: string;
  blockNumber: number;
  timestamp?: string;
  from: string;
  to: string | null;
  value: string;
  valueFormatted: string;
  gasUsed?: string;
  gasPrice?: string;
  fee?: string;
  status: Status;
  methodId?: string;
  functionName?: string;
  isContractInteraction: boolean;
  tokenTransfers: Omit<TokenTransfer, "txHash">[];
  opReturn?: { hex: string; text?: string }[];
}

/** `ContractInfo` with the ABI and the source measured instead of shipped. */
export interface WireContract {
  address: string;
  isVerified: boolean;
  isProxy?: boolean;
  implementationAddress?: string;
  name?: string;
  compilerVersion?: string;
  isToken?: boolean;
  tokenStandard?: string;
  creator?: string;
  creationTxHash?: string;
  abiEntries: number | null;
  sourceLength: number | null;
}

export interface Answer {
  provider: string;
  chain: string;
  fetchedAt: string;
}

export interface BalanceAnswer extends Answer {
  input: string;
  balance: Balance;
}

export interface HistoryAnswer extends Answer {
  input: string;
  address: string;
  limit: number;
  page: number;
  items: WireTransaction[];
}

export interface DetailAnswer extends Answer {
  hash: string;
  transaction: WireTransaction;
}

export interface ContractAnswer extends Answer {
  input: string;
  contract: WireContract;
}

export interface TokensAnswer extends Answer {
  input: string;
  total: number;
  items: TokenBalance[];
}

export interface UtxosAnswer extends Answer {
  input: string;
  address: string;
  total: number;
  items: Utxo[];
}

export interface TransfersAnswer extends Answer {
  input: string;
  address: string;
  token: string | null;
  limit: number;
  page: number;
  items: TokenTransfer[];
}

export interface GasAnswer extends Answer {
  gas: GasData;
}

export interface BlockAnswer extends Answer {
  number: number;
  block: BlockInfo;
}

export interface ProviderStatus {
  provider: string;
  configured: boolean;
  keyless: boolean;
}

export interface ProvidersAnswer {
  version: string;
  providers: ProviderStatus[];
}

export interface TipStat {
  label: string;
  value: string;
  hint?: string;
}

export interface TipBlock {
  number: number;
  hash: string;
  timestamp: string;
  txCount: number;
  miner: string | null;
  producer: string | null;
  gasUsed: string | null;
  gasLimit: string | null;
  size: number | null;
}

/** One row of a block's transaction list; the feed adds where and when. */
export interface BlockTransaction {
  hash: string;
  from: string | null;
  to: string | null;
  value: string;
  valueFormatted: string;
  fee: string | null;
  status: Status;
  method: string | null;
}

export interface TipTransaction extends BlockTransaction {
  timestamp: string | null;
  blockNumber: number | null;
}

export interface TipAnswer {
  chain: string;
  /** Which explorer API answered: blockscout, mempool or the Arweave gateway. */
  source: string;
  height: number;
  symbol: string;
  /** The unit of `fee` on the transactions, when the feed carries fees. */
  feeUnit: string | null;
  stats: TipStat[];
  blocks: TipBlock[];
  transactions: TipTransaction[];
  fetchedAt: string;
}

export interface BlockTransactionsAnswer {
  chain: string;
  number: number;
  source: string;
  total: number | null;
  items: BlockTransaction[];
  fetchedAt: string;
}
