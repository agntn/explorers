/**
 * Blockscout provider — open-source block explorer
 *
 * No API key needed. Deployed on many chains. REST API v2.
 *
 * Public instances: - eth.blockscout.com - base.blockscout.com - optimism.blockscout.com -
 * arbitrum.blockscout.com - gnosis.blockscout.com - polygon.blockscout.com - linea.blockscout.com -
 * scroll.blockscout.com - zksync.blockscout.com
 */

import type {
  ProviderCapabilities,
  ProviderConfig,
  ChainKey,
  Balance,
  Transaction,
  TxHistoryOptions,
  ContractInfo,
  TokenBalance,
  TokenBalanceOptions,
  TokenTransferOptions,
  GasData,
  BlockInfo,
  TxStatus,
  TokenTransfer,
} from "../core/types.js";
import { Provider } from "../core/provider.js";
import { buildQuery } from "../core/client.js";
import { NotFoundError, UnsupportedChainError } from "../core/errors.js";
import { assertSafePathSegment } from "../core/path-safety.js";
import { create as createChain } from "@agntn/chains";
import { clampMaxResults, formatWei, multiplyIntegerStrings } from "../core/types.js";

const DEFAULT_BASE = "https://eth.blockscout.com";
const TOKEN_BALANCE_DEFAULT_TIMEOUT = 60_000;

const CHAIN_BASES: Partial<Record<ChainKey, string>> = {
  ethereum: DEFAULT_BASE,
  base: "https://base.blockscout.com",
  arbitrum: "https://arbitrum.blockscout.com",
  optimism: "https://optimism.blockscout.com",
  polygon: "https://polygon.blockscout.com",
  gnosis: "https://gnosis.blockscout.com",
  linea: "https://linea.blockscout.com",
  scroll: "https://scroll.blockscout.com",
  zksync: "https://zksync.blockscout.com",
  avalanche: "https://avalanche.blockscout.com",
};

interface BlockscoutAddress {
  readonly hash: string;
  readonly coin_balance: string | null;
  readonly implementation_address?: string;
  readonly is_contract: boolean;
  readonly is_verified: boolean;
  readonly name?: string;
  readonly token?: {
    readonly name: string;
    readonly symbol: string;
    readonly decimals: string;
    readonly type: string;
  };
}

interface BlockscoutTx {
  readonly hash: string;
  /** Null until the transaction is mined. */
  readonly block_number: number | null;
  readonly timestamp: string | null;
  readonly from: { readonly hash: string };
  readonly to: { readonly hash: string } | null;
  readonly value: string;
  readonly gas_used: string | null;
  readonly gas_price: string | null;
  /** "ok", "error", or null while the transaction is still pending. */
  readonly status: string | null;
  readonly method?: string;
  readonly transaction_types?: readonly string[];
  readonly token_transfers?: readonly BlockscoutTokenTransfer[];
}

interface BlockscoutTokenTransfer {
  readonly token: {
    readonly address_hash: string;
    readonly symbol: string;
    readonly name: string;
    readonly decimals: string;
    readonly type: string;
  };
  readonly from: { readonly hash: string };
  readonly to: { readonly hash: string };
  /** ERC-721/1155 transfers carry token_id here instead of value. */
  readonly total: { readonly value?: string };
  readonly transaction_hash: string;
  readonly block_number: number;
  readonly timestamp: string;
}

interface BlockscoutTokenBalance {
  readonly token: {
    readonly address_hash: string;
    readonly symbol: string | null;
    readonly name: string | null;
    readonly decimals: string | null;
    readonly type: string;
  } | null;
  readonly value: string;
  readonly token_id?: string;
}

interface BlockscoutContractInfo {
  readonly is_verified: boolean;
  readonly is_proxy?: boolean;
  readonly proxy_type?: string | null;
  readonly implementation_address?: string;
  readonly implementations?: ReadonlyArray<{ readonly address_hash: string }>;
  readonly name?: string;
  readonly compiler_version?: string;
  readonly abi?: ReadonlyArray<Readonly<Record<string, unknown>>>;
  readonly source_code?: string;
  readonly creation_tx_hash?: string;
  readonly deployer?: string;
}

interface BlockscoutBlock {
  readonly height: number;
  readonly hash: string;
  readonly parent_hash: string;
  readonly timestamp: string;
  readonly miner: { readonly hash: string };
  readonly gas_used: string;
  readonly gas_limit: string;
  readonly transactions_count: number;
  readonly base_fee_per_gas?: string;
}

interface BlockscoutGasPrice {
  readonly average?: string | number;
  readonly fast?: string | number;
  readonly slow?: string | number;
}

interface BlockscoutTransactionPage {
  readonly items: readonly BlockscoutTx[];
  readonly next_page_params?: Record<string, string | number> | null;
}

function getBase(chain: ChainKey): string {
  const base = CHAIN_BASES[chain];
  if (!base) throw new UnsupportedChainError(chain, "blockscout");
  return base;
}

/* Map fungible transfers to the domain shape; ERC-721/1155 items have no value and are skipped. */
function mapTokenTransfers(raw: Readonly<BlockscoutTokenTransfer[] | undefined>): TokenTransfer[] {
  const transfers: TokenTransfer[] = [];
  for (const tt of raw ?? []) {
    if (tt.total.value === null || tt.total.value === undefined) continue;
    const decimals = Number(tt.token.decimals);
    transfers.push({
      contract: tt.token.address_hash,
      symbol: tt.token.symbol,
      name: tt.token.name,
      decimals,
      value: tt.total.value,
      valueFormatted: formatWei(tt.total.value, decimals),
      from: tt.from.hash,
      to: tt.to.hash,
      txHash: tt.transaction_hash,
      blockNumber: tt.block_number,
      timestamp: tt.timestamp,
    });
  }
  return transfers;
}

function transactionFee(raw: Readonly<BlockscoutTx>): string | undefined {
  if (raw.gas_used === null || raw.gas_used === undefined) return undefined;
  if (raw.gas_price === null || raw.gas_price === undefined) return undefined;
  return multiplyIntegerStrings(raw.gas_used, raw.gas_price);
}

function transactionStatus(status: string | null | undefined): TxStatus {
  if (status === "ok") return "success";
  return status === null || status === undefined ? "pending" : "failed";
}

function mapTx(raw: Readonly<BlockscoutTx>): Transaction {
  const valueWei = BigInt(raw.value).toString();

  return {
    hash: raw.hash,
    // Transaction.blockNumber is required, so pending txs get 0, the same
    // sentinel the etherscan and mempool providers use.
    blockNumber: raw.block_number ?? 0,
    timestamp: raw.timestamp ?? undefined,
    from: raw.from.hash,
    to: raw.to?.hash ?? null,
    value: valueWei,
    valueFormatted: formatWei(valueWei),
    gasUsed: raw.gas_used ?? undefined,
    gasPrice: raw.gas_price ?? undefined,
    fee: transactionFee(raw),
    status: transactionStatus(raw.status),
    methodId: undefined,
    functionName: raw.method,
    isContractInteraction: raw.transaction_types?.includes("contract_call") ?? false,
    tokenTransfers: mapTokenTransfers(raw.token_transfers),
    raw: raw as unknown as Record<string, unknown>,
  };
}

function isTokenAbi(abi: readonly Readonly<Record<string, unknown>>[] | undefined): boolean {
  return (
    abi?.some((item) => {
      if (item.type !== "function") return false;
      const name = typeof item.name === "string" ? item.name : undefined;
      return name === "transfer" || name === "balanceOf" || name === "totalSupply";
    }) ?? false
  );
}

function isProxyContract(data: Readonly<BlockscoutContractInfo>): boolean {
  if (data.is_proxy !== null && data.is_proxy !== undefined) return data.is_proxy;
  const hasProxyType = data.proxy_type !== null && data.proxy_type !== undefined;
  return hasProxyType || (data.implementations?.length ?? 0) > 0;
}

function mapContractInfo(address: string, data: Readonly<BlockscoutContractInfo>): ContractInfo {
  return {
    address,
    isVerified: data.is_verified,
    isProxy: isProxyContract(data),
    implementationAddress: data.implementation_address ?? data.implementations?.[0]?.address_hash,
    name: data.name,
    compilerVersion: data.compiler_version,
    abi: data.abi ? JSON.stringify(data.abi) : undefined,
    sourceCode: data.source_code,
    isToken: isTokenAbi(data.abi),
    creator: data.deployer,
    creationTxHash: data.creation_tx_hash,
  };
}

export class Blockscout extends Provider {
  static readonly key = "blockscout";

  private defaultChain: ChainKey;
  private readonly tokenBalanceTimeout: number;

  constructor(config: Readonly<ProviderConfig>) {
    super(config);
    this.defaultChain = config.defaultChain ?? "ethereum";
    this.tokenBalanceTimeout = config.timeout ?? TOKEN_BALANCE_DEFAULT_TIMEOUT;
  }
  get capabilities(): ProviderCapabilities {
    return {
      balances: true,
      txHistory: true,
      txDetail: true,
      contractInfo: true,
      tokenBalances: true,
      tokenTransfers: true,
      gasData: true,
      blockInfo: true,
    };
  }

  private base(chain?: ChainKey): string {
    return getBase(chain ?? this.defaultChain);
  }

  async getBalance(address: string, chain?: ChainKey): Promise<Balance> {
    const c = chain ?? this.defaultChain;
    assertSafePathSegment(address, "address");
    const url = `${this.base(c)}/api/v2/addresses/${encodeURIComponent(address)}`;
    const data = await this.getJSON<BlockscoutAddress>(url);
    const balance = data.coin_balance ?? "0";

    return this.snapshotBalance({
      address,
      chain: c,
      balance,
      balanceFormatted: formatWei(balance),
      symbol: createChain(c).symbol,
    });
  }

  /**
   * Follow Blockscout's 50-item keyset pages up to the 100-result provider limit.
   *
   * @param {string} address - The `address` value.
   * @param {ChainKey} chain - The `chain` value.
   * @param {Readonly<TxHistoryOptions>} options - The `options` value.
   * @returns {Promise<Transaction[]>} The resulting value.
   */
  async getTxHistory(
    address: string,
    chain?: ChainKey,
    options?: Readonly<TxHistoryOptions>,
  ): Promise<Transaction[]> {
    const c = chain ?? this.defaultChain;
    assertSafePathSegment(address, "address");
    const limit = clampMaxResults(options?.limit);
    const baseUrl = `${this.base(c)}/api/v2/addresses/${encodeURIComponent(address)}/transactions`;

    const transactions: Transaction[] = [];
    let cursor: Record<string, string | number> = {};
    for (let fetches = 0; fetches < 2 && transactions.length < limit; fetches++) {
      const data = await this.getJSON<BlockscoutTransactionPage>(`${baseUrl}${buildQuery(cursor)}`);
      if (!data.items.length) break;
      transactions.push(...data.items.slice(0, limit - transactions.length).map(mapTx));
      if (!data.next_page_params) break;
      cursor = data.next_page_params;
    }
    return transactions.slice(0, limit);
  }

  override async getTxDetail(hash: string, chain?: ChainKey): Promise<Transaction> {
    const c = chain ?? this.defaultChain;
    assertSafePathSegment(hash, "tx hash");
    const url = `${this.base(c)}/api/v2/transactions/${encodeURIComponent(hash)}`;
    const data = await this.getJSON<BlockscoutTx>(url);
    return mapTx(data);
  }

  override async getContractInfo(address: string, chain?: ChainKey): Promise<ContractInfo> {
    const c = chain ?? this.defaultChain;
    assertSafePathSegment(address, "address");

    // Try verified contract first
    try {
      const url = `${this.base(c)}/api/v2/smart-contracts/${encodeURIComponent(address)}`;
      const data = await this.getJSON<BlockscoutContractInfo>(url);
      return mapContractInfo(address, data);
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
      const addrUrl = `${this.base(c)}/api/v2/addresses/${encodeURIComponent(address)}`;
      const addr = await this.getJSON<BlockscoutAddress>(addrUrl);

      return {
        address,
        isVerified: addr.is_verified,
        name: addr.name,
        isToken: addr.token !== null && addr.token !== undefined,
      };
    }
  }

  override async getTokenBalances(
    address: string,
    chain?: ChainKey,
    options?: Readonly<TokenBalanceOptions>,
  ): Promise<TokenBalance[]> {
    const c = chain ?? this.defaultChain;
    assertSafePathSegment(address, "address");
    const url = `${this.base(c)}/api/v2/addresses/${encodeURIComponent(address)}/token-balances`;
    const balances = await this.getJSON<BlockscoutTokenBalance[]>(url, {
      timeout: this.tokenBalanceTimeout,
    });

    let tokens = balances.flatMap<TokenBalance>((item) => {
      const token = item.token;
      if (token?.type !== "ERC-20") return [];
      const decimals = Number(token.decimals ?? 0);
      return [
        {
          contract: token.address_hash,
          symbol: token.symbol ?? "",
          name: token.name ?? undefined,
          decimals,
          balance: item.value,
          balanceFormatted: formatWei(item.value, decimals),
        },
      ];
    });

    if (options?.nonZeroOnly) {
      tokens = tokens.filter((t) => t.balance !== "0");
    }

    return tokens;
  }

  /**
   * Walk the keyset-paginated ERC-20 transfer list until `limit` is reached.
   *
   * The endpoint accepts only a token filter and a `next_page_params` cursor. Block range, sort,
   * and page have no server-side equivalent and are ignored, the same way `getTxHistory` ignores
   * them.
   *
   * @param {string} address - The `address` value.
   * @param {ChainKey} chain - The `chain` value.
   * @param {Readonly<TokenTransferOptions>} options - The `options` value.
   * @returns {Promise<TokenTransfer[]>} The resulting value.
   */
  override async getTokenTransfers(
    address: string,
    chain?: ChainKey,
    options?: Readonly<TokenTransferOptions>,
  ): Promise<TokenTransfer[]> {
    const c = chain ?? this.defaultChain;
    assertSafePathSegment(address, "address");
    const limit = clampMaxResults(options?.limit);
    const baseUrl = `${this.base(c)}/api/v2/addresses/${encodeURIComponent(address)}/token-transfers`;

    const transfers: TokenTransfer[] = [];
    let cursor: Record<string, string | number> = {};
    // Pages hold 50 items and the limit clamps at 100, so 4 fetches always cover it.
    for (let fetches = 0; fetches < 4 && transfers.length < limit; fetches++) {
      const query = buildQuery({ type: "ERC-20", token: options?.token, ...cursor });
      const data = await this.getJSON<{
        items?: BlockscoutTokenTransfer[];
        next_page_params?: Record<string, string | number> | null;
      }>(`${baseUrl}${query}`);
      if (!data.items?.length) break;
      transfers.push(...mapTokenTransfers(data.items));
      if (!data.next_page_params) break;
      cursor = data.next_page_params;
    }
    return transfers.slice(0, limit);
  }

  override async getGasData(chain?: ChainKey): Promise<GasData> {
    const c = chain ?? this.defaultChain;
    const url = `${this.base(c)}/api/v2/stats`;
    const data = await this.getJSON<Record<string, unknown>>(url);

    // Blockscout stats endpoint varies; extract gas data if available
    const gasPrices = data.gas_prices as BlockscoutGasPrice | undefined;

    return {
      chain: c,
      unit: "gwei",
      safeGasPrice: gasPrices?.slow === undefined ? undefined : String(gasPrices.slow),
      proposedGasPrice: gasPrices?.average === undefined ? undefined : String(gasPrices.average),
      fastGasPrice: gasPrices?.fast === undefined ? undefined : String(gasPrices.fast),
    };
  }

  override async getBlockInfo(blockNumber: number, chain?: ChainKey): Promise<BlockInfo> {
    const c = chain ?? this.defaultChain;
    assertSafePathSegment(String(blockNumber), "block number");
    const url = `${this.base(c)}/api/v2/blocks/${encodeURIComponent(String(blockNumber))}`;
    const data = await this.getJSON<BlockscoutBlock>(url);

    return {
      number: data.height,
      hash: data.hash,
      parentHash: data.parent_hash,
      timestamp: data.timestamp,
      miner: data.miner.hash,
      gasUsed: data.gas_used,
      gasLimit: data.gas_limit,
      txCount: data.transactions_count,
      baseFee: data.base_fee_per_gas,
    };
  }
}
