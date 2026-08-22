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
  GasData,
  BlockInfo,
  TxStatus,
  TokenTransfer,
} from "../core/types.js";
import { Provider } from "../core/provider.js";
import { NotFoundError, UnsupportedChainError } from "../core/errors.js";
import { register } from "../core/registry.js";
import { assertSafePathSegment } from "../core/path-safety.js";
import { create as createChain } from "@agntn/chains";
import { clampMaxResults, formatWei, multiplyIntegerStrings } from "../core/types.js";

const CHAIN_BASES: Partial<Record<ChainKey, string>> = {
  eth: "https://eth.blockscout.com",
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
  hash: string;
  coin_balance: string;
  implementation_address?: string;
  is_contract: boolean;
  is_verified: boolean;
  name?: string;
  token?: {
    name: string;
    symbol: string;
    decimals: string;
    type: string;
  };
}

interface BlockscoutTx {
  hash: string;
  /** Null until the transaction is mined. */
  block_number: number | null;
  timestamp: string | null;
  from: { hash: string };
  to: { hash: string } | null;
  value: string;
  gas_used: string | null;
  gas_price: string | null;
  /** "ok", "error", or null while the transaction is still pending. */
  status: string | null;
  method?: string;
  transaction_types?: string[];
  token_transfers?: BlockscoutTokenTransfer[];
}

interface BlockscoutTokenTransfer {
  token: {
    address_hash: string;
    symbol: string;
    name: string;
    decimals: string;
    type: string;
  };
  from: { hash: string };
  to: { hash: string };
  /** ERC-721/1155 transfers carry token_id here instead of value. */
  total: { value?: string };
  transaction_hash: string;
  block_number: number;
  timestamp: string;
}

interface BlockscoutTokenBalance {
  token: {
    address_hash: string;
    symbol: string;
    name: string;
    decimals: string;
    type: string;
  };
  value: string;
  token_id?: string;
}

interface BlockscoutContractInfo {
  is_verified: boolean;
  is_proxy?: boolean;
  proxy_type?: string | null;
  implementation_address?: string;
  implementations?: Array<{ address_hash: string }>;
  name?: string;
  compiler_version?: string;
  abi?: Array<Record<string, unknown>>;
  source_code?: string;
  creation_tx_hash?: string;
  deployer?: string;
}

interface BlockscoutBlock {
  height: number;
  hash: string;
  parent_hash: string;
  timestamp: string;
  miner: { hash: string };
  gas_used: string;
  gas_limit: string;
  transactions_count: number;
  base_fee_per_gas?: string;
}

interface BlockscoutGasPrice {
  average?: string | number;
  fast?: string | number;
  slow?: string | number;
}

function getBase(chain: ChainKey): string {
  const base = CHAIN_BASES[chain];
  if (!base) throw new UnsupportedChainError(chain, "blockscout");
  return base;
}

/** Map fungible transfers to the domain shape; ERC-721/1155 items have no value and are skipped. */
function mapTokenTransfers(raw: BlockscoutTokenTransfer[] | undefined): TokenTransfer[] {
  const transfers: TokenTransfer[] = [];
  for (const tt of raw ?? []) {
    if (tt.total.value == null) continue;
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

function mapTx(raw: BlockscoutTx): Transaction {
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
    fee:
      raw.gas_used != null && raw.gas_price != null
        ? multiplyIntegerStrings(raw.gas_used, raw.gas_price)
        : undefined,
    status: (raw.status === "ok"
      ? "success"
      : raw.status == null
        ? "pending"
        : "failed") as TxStatus,
    methodId: undefined,
    functionName: raw.method,
    isContractInteraction: raw.transaction_types?.includes("contract_call") ?? false,
    tokenTransfers: mapTokenTransfers(raw.token_transfers),
    raw: raw as unknown as Record<string, unknown>,
  };
}

class Blockscout extends Provider {
  static readonly key = "blockscout";

  private defaultChain: ChainKey;

  constructor(config: ProviderConfig) {
    super(config);
    this.defaultChain = config.defaultChain ?? "eth";
  }
  get capabilities(): ProviderCapabilities {
    return {
      balances: true,
      txHistory: true,
      txDetail: true,
      contractInfo: true,
      tokenBalances: true,
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

    return {
      address,
      chain: c,
      balance: data.coin_balance,
      balanceFormatted: formatWei(data.coin_balance),
      symbol: createChain(c).symbol,
    };
  }

  async getTxHistory(
    address: string,
    chain?: ChainKey,
    options?: TxHistoryOptions,
  ): Promise<Transaction[]> {
    const c = chain ?? this.defaultChain;
    assertSafePathSegment(address, "address");
    const limit = clampMaxResults(options?.limit);
    const url = `${this.base(c)}/api/v2/addresses/${encodeURIComponent(address)}/transactions`;

    const data = await this.getJSON<{ items: BlockscoutTx[] }>(url);

    if (!data.items?.length) return [];
    return data.items.slice(0, limit).map(mapTx);
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
      const isToken =
        data.abi?.some((item) => {
          if (item.type !== "function") return false;
          const name = item.name as string | undefined;
          return name === "transfer" || name === "balanceOf" || name === "totalSupply";
        }) ?? false;

      return {
        address,
        isVerified: data.is_verified,
        isProxy:
          data.is_proxy ?? (data.proxy_type != null || (data.implementations?.length ?? 0) > 0),
        implementationAddress:
          data.implementation_address ?? data.implementations?.[0]?.address_hash,
        name: data.name,
        compilerVersion: data.compiler_version,
        abi: data.abi ? JSON.stringify(data.abi) : undefined,
        sourceCode: data.source_code,
        isToken,
        creator: data.deployer,
        creationTxHash: data.creation_tx_hash,
      };
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
      const addrUrl = `${this.base(c)}/api/v2/addresses/${encodeURIComponent(address)}`;
      const addr = await this.getJSON<BlockscoutAddress>(addrUrl);

      return {
        address,
        isVerified: addr.is_verified,
        name: addr.name,
        isToken: addr.token != null,
      };
    }
  }

  override async getTokenBalances(
    address: string,
    chain?: ChainKey,
    options?: TokenBalanceOptions,
  ): Promise<TokenBalance[]> {
    const c = chain ?? this.defaultChain;
    assertSafePathSegment(address, "address");
    const url = `${this.base(c)}/api/v2/addresses/${encodeURIComponent(address)}/tokens`;
    const data = await this.getJSON<{ items: BlockscoutTokenBalance[] }>(url);

    let tokens = data.items.map((item) => ({
      contract: item.token.address_hash,
      symbol: item.token.symbol,
      name: item.token.name,
      decimals: Number(item.token.decimals),
      balance: item.value,
      balanceFormatted: formatWei(item.value, Number(item.token.decimals)),
    }));

    if (options?.nonZeroOnly) {
      tokens = tokens.filter((t) => t.balance !== "0");
    }

    return tokens;
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

register(Blockscout, "https://eth.blockscout.com");
