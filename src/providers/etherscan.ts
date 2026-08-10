/**
 * Etherscan V2 provider.
 *
 * Uses Etherscan's unified multichain endpoint for Ethereum, Base, Arbitrum,
 * Optimism, Polygon, BSC, Avalanche, Gnosis, Linea, and Berachain.
 *
 * Auth: Etherscan API key.
 * Env: ETHERSCAN_API_KEY
 */

import type {
  ProviderCapabilities,
  ProviderConfig,
  Chain,
  Balance,
  Transaction,
  TxHistoryOptions,
  ContractInfo,
  TokenBalance,
  TokenBalanceOptions,
  GasData,
  BlockInfo,
  TxStatus,
} from "../core/types.js";
import { Provider } from "../core/provider.js";
import { buildQuery, normalizeBaseUrl } from "../core/client.js";
import {
  AuthError,
  BlocexError,
  NotFoundError,
  RateLimitError,
  UnsupportedChainError,
} from "../core/errors.js";
import { register } from "../core/registry.js";
import { CHAIN_DATA } from "chains";
import { clampMaxResults, formatWei, multiplyIntegerStrings } from "../core/types.js";

const DEFAULT_BASE = "https://api.etherscan.io/v2/api";
const SUPPORTED_CHAINS = new Set<Chain>([
  "eth",
  "base",
  "arbitrum",
  "optimism",
  "polygon",
  "bsc",
  "avalanche",
  "gnosis",
  "linea",
  "bera",
]);

interface EtherscanResponse<T> {
  status?: string;
  message?: string;
  result?: T;
  error?: { code: number; message: string };
}

interface EtherscanTx {
  blockNumber: string;
  timeStamp: string;
  hash: string;
  from: string;
  to: string;
  value: string;
  gas: string;
  gasUsed: string;
  gasPrice: string;
  isError: string;
  txreceipt_status: string;
  input: string;
  functionName?: string;
  methodId?: string;
  contractAddress: string;
  confirmations: string;
}

interface EtherscanTokenBalance {
  TokenAddress: string;
  TokenName: string;
  TokenSymbol: string;
  TokenDivisor: string;
  TokenQuantity: string;
}

interface EtherscanGasResult {
  LastBlock: string;
  SafeGasPrice: string;
  ProposeGasPrice: string;
  FastGasPrice: string;
  suggestBaseFee: string;
  gasUsedRatio: string;
}

interface EtherscanBlockResult {
  number: string;
  hash: string;
  parentHash: string;
  timestamp: string;
  miner: string;
  gasLimit: string;
  gasUsed: string;
  baseFeePerGas?: string;
  transactions: string[];
}

function getChainId(chain: Chain): string {
  const chainId = CHAIN_DATA[chain]?.chainId;
  if (!SUPPORTED_CHAINS.has(chain) || !chainId) {
    throw new UnsupportedChainError(chain, "etherscan");
  }
  return BigInt(chainId).toString();
}

function mapTx(raw: EtherscanTx): Transaction {
  const status: TxStatus =
    raw.isError === "1" || raw.txreceipt_status === "0" ? "failed" : "success";
  return {
    hash: raw.hash,
    blockNumber: Number(raw.blockNumber),
    timestamp: new Date(Number(raw.timeStamp) * 1000).toISOString(),
    from: raw.from,
    to: raw.to || null,
    value: raw.value,
    valueFormatted: formatWei(raw.value),
    gasUsed: raw.gasUsed,
    gasPrice: raw.gasPrice,
    fee: multiplyIntegerStrings(raw.gasUsed, raw.gasPrice),
    status,
    methodId: raw.methodId,
    functionName: raw.functionName,
    isContractInteraction: raw.input !== "0x" && raw.input.length > 2,
    tokenTransfers: [],
    raw: raw as unknown as Record<string, unknown>,
  };
}

class Etherscan extends Provider {
  static readonly key = "etherscan";

  private readonly apiKey: string;
  private readonly apiUrl: string;
  private readonly defaultChain: Chain;

  constructor(config: ProviderConfig) {
    super(config);
    const key = config.apiKey ?? process.env.ETHERSCAN_API_KEY ?? "";
    if (!key) {
      throw new AuthError("etherscan", "Set ETHERSCAN_API_KEY or pass apiKey in config");
    }
    this.apiKey = key;
    this.apiUrl = normalizeBaseUrl(config.baseUrl ?? DEFAULT_BASE);
    this.defaultChain = config.defaultChain ?? "eth";
    getChainId(this.defaultChain);
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

  private async api<T>(
    chain: Chain,
    module: string,
    action: string,
    params: Record<string, string | number | undefined> = {},
  ): Promise<T> {
    const query = buildQuery({
      chainid: getChainId(chain),
      module,
      action,
      apikey: this.apiKey,
      ...params,
    });
    const response = await this.getJSON<EtherscanResponse<T>>(`${this.apiUrl}${query}`);

    if (response.error) {
      throw new BlocexError(`Etherscan API error: ${response.error.message}`, "etherscan");
    }

    if (response.status === "0") {
      const detail = typeof response.result === "string" ? response.result : response.message;
      const message = detail || "Unknown Etherscan API error";
      if (
        (action === "txlist" && /no transactions found/i.test(message)) ||
        (action === "addresstokenbalance" && /no (token|record)/i.test(message))
      ) {
        return [] as T;
      }
      if (/rate limit/i.test(message)) throw new RateLimitError("etherscan");
      if (/invalid api key|missing\/invalid api key/i.test(message)) {
        throw new AuthError("etherscan", "Invalid API key");
      }
      throw new BlocexError(`Etherscan API error: ${message}`, "etherscan");
    }

    if (!("result" in response)) {
      throw new BlocexError("Etherscan API response did not include a result", "etherscan");
    }
    return response.result as T;
  }

  async getBalance(address: string, chain?: Chain): Promise<Balance> {
    const c = chain ?? this.defaultChain;
    const result = await this.api<string>(c, "account", "balance", {
      address,
      tag: "latest",
    });

    return {
      address,
      chain: c,
      balance: result,
      balanceFormatted: formatWei(result),
      symbol: CHAIN_DATA[c]?.symbol ?? "ETH",
    };
  }

  async getTxHistory(
    address: string,
    chain?: Chain,
    options?: TxHistoryOptions,
  ): Promise<Transaction[]> {
    const c = chain ?? this.defaultChain;
    const limit = clampMaxResults(options?.limit);
    const result = await this.api<EtherscanTx[]>(c, "account", "txlist", {
      address,
      startblock: options?.startBlock ?? 0,
      endblock: options?.endBlock ?? 99999999,
      page: options?.page ?? 1,
      offset: limit,
      sort: options?.sort ?? "desc",
    });

    if (!Array.isArray(result)) return [];
    return result.map(mapTx);
  }

  override async getTxDetail(hash: string, chain?: Chain): Promise<Transaction> {
    const c = chain ?? this.defaultChain;
    const tx = await this.api<Record<string, string | null> | null>(
      c,
      "proxy",
      "eth_getTransactionByHash",
      { txhash: hash },
    );

    if (!tx?.hash) {
      throw new NotFoundError(`Transaction ${hash}`, "etherscan");
    }

    const receipt = await this.api<Record<string, string | null> | null>(
      c,
      "proxy",
      "eth_getTransactionReceipt",
      { txhash: hash },
    );

    const gasUsed = receipt?.gasUsed ? BigInt(receipt.gasUsed).toString() : undefined;
    const gasPrice = tx.gasPrice ? BigInt(tx.gasPrice).toString() : undefined;

    return {
      hash: tx.hash,
      blockNumber: Number(tx.blockNumber ?? "0x0"),
      from: tx.from ?? "",
      to: tx.to ?? null,
      value: tx.value ? BigInt(tx.value).toString() : "0",
      valueFormatted: tx.value ? formatWei(BigInt(tx.value).toString()) : "0",
      gasUsed,
      gasPrice,
      fee: gasUsed && gasPrice ? multiplyIntegerStrings(gasUsed, gasPrice) : undefined,
      status: !receipt ? "pending" : receipt.status === "0x1" ? "success" : "failed",
      methodId: tx.input ? tx.input.slice(0, 10) : undefined,
      isContractInteraction: (tx.input?.length ?? 0) > 10,
      tokenTransfers: [],
      raw: { ...tx, receipt } as Record<string, unknown>,
    };
  }

  override async getContractInfo(address: string, chain?: Chain): Promise<ContractInfo> {
    const c = chain ?? this.defaultChain;

    const source = await this.api<Array<Record<string, string>>>(c, "contract", "getsourcecode", {
      address,
    });
    const contract = source[0];
    const isVerified = contract?.ABI !== "Contract source code not verified" && !!contract?.ABI;

    const abi = isVerified ? contract.ABI : undefined;
    const name = contract?.ContractName || undefined;
    const compilerVersion = contract?.CompilerVersion || undefined;
    const sourceCode = isVerified ? contract.SourceCode : undefined;

    return {
      address,
      isVerified,
      name,
      compilerVersion,
      abi,
      sourceCode,
      isProxy: contract?.Proxy === "1",
      implementationAddress: contract?.Implementation || undefined,
    };
  }

  override async getTokenBalances(
    address: string,
    chain?: Chain,
    options?: TokenBalanceOptions,
  ): Promise<TokenBalance[]> {
    const c = chain ?? this.defaultChain;
    const result = await this.api<EtherscanTokenBalance[]>(c, "account", "addresstokenbalance", {
      address,
    });

    let tokens = result.map((token) => {
      const decimals = Number(token.TokenDivisor);
      return {
        contract: token.TokenAddress,
        symbol: token.TokenSymbol,
        name: token.TokenName,
        decimals,
        balance: token.TokenQuantity,
        balanceFormatted: formatWei(token.TokenQuantity, decimals),
      };
    });

    if (options?.nonZeroOnly) {
      tokens = tokens.filter((t) => t.balance !== "0");
    }

    return tokens;
  }

  override async getGasData(chain?: Chain): Promise<GasData> {
    const c = chain ?? this.defaultChain;
    const result = await this.api<EtherscanGasResult>(c, "gastracker", "gasoracle");

    return {
      chain: c,
      unit: "gwei",
      safeGasPrice: result.SafeGasPrice,
      proposedGasPrice: result.ProposeGasPrice,
      fastGasPrice: result.FastGasPrice,
      baseFee: result.suggestBaseFee,
    };
  }

  override async getBlockInfo(blockNumber: number, chain?: Chain): Promise<BlockInfo> {
    const c = chain ?? this.defaultChain;
    const result = await this.api<EtherscanBlockResult | null>(c, "proxy", "eth_getBlockByNumber", {
      tag: `0x${blockNumber.toString(16)}`,
      boolean: "false",
    });
    if (!result) {
      throw new NotFoundError(`Block ${blockNumber}`, "etherscan");
    }

    return {
      number: Number(result.number),
      hash: result.hash,
      parentHash: result.parentHash,
      timestamp: new Date(Number(result.timestamp) * 1000).toISOString(),
      miner: result.miner,
      gasUsed: BigInt(result.gasUsed).toString(),
      gasLimit: BigInt(result.gasLimit).toString(),
      txCount: result.transactions.length,
      baseFee: result.baseFeePerGas ? BigInt(result.baseFeePerGas).toString() : undefined,
    };
  }
}

register(Etherscan, DEFAULT_BASE);
