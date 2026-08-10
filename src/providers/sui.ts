/**
 * Sui provider — Sui public GraphQL RPC
 *
 * Public RPC, no key needed. SUI balance, tx history, tx detail, gas, and block info.
 * Sui uses MIST: 1 SUI = 1,000,000,000 MIST.
 *
 * https://docs.sui.io/develop/accessing-data/graphql/graphql-rpc
 */

import type {
  ProviderCapabilities,
  ProviderConfig,
  Chain,
  Balance,
  Transaction,
  TxHistoryOptions,
  GasData,
  BlockInfo,
  TxStatus,
} from "../core/types.js";
import { Provider } from "../core/provider.js";
import { normalizeBaseUrl } from "../core/client.js";
import { normalizeError, NotFoundError, UnsupportedChainError } from "../core/errors.js";
import { register } from "../core/registry.js";
import { clampMaxResults, formatWei } from "../core/types.js";

const DEFAULT_BASE = "https://graphql.mainnet.sui.io/graphql";

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

interface SuiTransaction {
  digest: string;
  sender?: { address: string } | null;
  gasInput?: { gasPrice: string } | null;
  kind?: { __typename: string } | null;
  effects?: {
    status: "SUCCESS" | "FAILURE";
    timestamp?: string | null;
    checkpoint?: { sequenceNumber: number } | null;
    gasEffects?: {
      gasSummary?: {
        computationCost: string | number;
        storageCost: string | number;
        storageRebate: string | number;
      } | null;
    } | null;
  } | null;
}

interface SuiCheckpoint {
  sequenceNumber: number;
  digest: string;
  previousCheckpointDigest?: string | null;
  networkTotalTransactions: number;
  timestamp: string;
  rollingGasSummary: {
    computationCost: string | number;
    storageCost: string | number;
  };
}

const BALANCE_QUERY = `
  query Balance($address: SuiAddress!) {
    address(address: $address) {
      balance(coinType: "0x2::sui::SUI") {
        totalBalance
      }
    }
  }
`;

const TRANSACTION_FRAGMENT = `
  fragment TransactionFields on Transaction {
    digest
    sender {
      address
    }
    gasInput {
      gasPrice
    }
    kind {
      __typename
    }
    effects {
      status
      timestamp
      checkpoint {
        sequenceNumber
      }
      gasEffects {
        gasSummary {
          computationCost
          storageRebate
          storageCost
        }
      }
    }
  }
`;

const TX_HISTORY_QUERY = `
  ${TRANSACTION_FRAGMENT}
  query TransactionHistory($address: SuiAddress!, $limit: Int!) {
    address(address: $address) {
      transactions(last: $limit, relation: AFFECTED) {
        nodes {
          ...TransactionFields
        }
      }
    }
  }
`;

const TX_DETAIL_QUERY = `
  ${TRANSACTION_FRAGMENT}
  query TransactionDetail($digest: String!) {
    transaction(digest: $digest) {
      ...TransactionFields
    }
  }
`;

const GAS_QUERY = `
  query GasPrice {
    epoch {
      referenceGasPrice
    }
  }
`;

const CHECKPOINT_QUERY = `
  query Checkpoint($number: UInt53!, $previous: UInt53!) {
    checkpoint(sequenceNumber: $number) {
      sequenceNumber
      digest
      previousCheckpointDigest
      networkTotalTransactions
      timestamp
      rollingGasSummary {
        computationCost
        storageCost
      }
    }
    previous: checkpoint(sequenceNumber: $previous) {
      networkTotalTransactions
    }
  }
`;

function mapTx(raw: SuiTransaction): Transaction {
  const gasSummary = raw.effects?.gasEffects?.gasSummary;
  const status: TxStatus = raw.effects
    ? raw.effects.status === "SUCCESS"
      ? "success"
      : "failed"
    : "pending";

  return {
    hash: raw.digest,
    blockNumber: raw.effects?.checkpoint?.sequenceNumber ?? 0,
    timestamp: raw.effects?.timestamp ?? undefined,
    from: raw.sender?.address ?? "",
    to: null,
    value: "0",
    valueFormatted: "0",
    fee: gasSummary
      ? (
          BigInt(gasSummary.computationCost) +
          BigInt(gasSummary.storageCost) -
          BigInt(gasSummary.storageRebate)
        ).toString()
      : undefined,
    gasPrice: raw.gasInput?.gasPrice,
    status,
    isContractInteraction: raw.kind?.__typename === "ProgrammableTransaction",
    tokenTransfers: [],
    raw: raw as unknown as Record<string, unknown>,
  };
}

class Sui extends Provider {
  private baseUrl: string;

  constructor(config: ProviderConfig) {
    super(config);
    this.baseUrl = normalizeBaseUrl(config.baseUrl ?? DEFAULT_BASE);
  }

  static readonly providerName = "sui";
  readonly name = Sui.providerName;

  get capabilities(): ProviderCapabilities {
    return {
      balances: true,
      txHistory: true,
      txDetail: true,
      contractInfo: false,
      tokenBalances: false,
      gasData: true,
      blockInfo: true,
    };
  }

  private async queryGraphQL<T>(
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<T> {
    const response = await this.postJSON<GraphQLResponse<T>>(this.baseUrl, { query, variables });
    const firstError = response.errors?.[0]?.message;
    if (firstError) {
      throw normalizeError(new Error(`Sui GraphQL error: ${firstError}`), "sui");
    }
    if (!response.data) {
      throw normalizeError(new Error("Sui GraphQL response did not include data"), "sui");
    }
    return response.data;
  }

  async getBalance(address: string, chain?: Chain): Promise<Balance> {
    const c = chain ?? "sui";
    if (c !== "sui") throw new UnsupportedChainError(c, "sui");

    const result = await this.queryGraphQL<{
      address: { balance: { totalBalance: string } | null } | null;
    }>(BALANCE_QUERY, { address });
    const totalBalance = result.address?.balance?.totalBalance ?? "0";

    return {
      address,
      chain: "sui",
      balance: totalBalance,
      balanceFormatted: formatWei(totalBalance, 9),
      symbol: "SUI",
    };
  }

  async getTxHistory(
    address: string,
    chain?: Chain,
    options?: TxHistoryOptions,
  ): Promise<Transaction[]> {
    const c = chain ?? "sui";
    if (c !== "sui") throw new UnsupportedChainError(c, "sui");

    const result = await this.queryGraphQL<{
      address: { transactions: { nodes: SuiTransaction[] } } | null;
    }>(TX_HISTORY_QUERY, {
      address,
      limit: clampMaxResults(options?.limit, 50),
    });

    return result.address?.transactions.nodes.map(mapTx) ?? [];
  }

  override async getTxDetail(hash: string, chain?: Chain): Promise<Transaction> {
    const c = chain ?? "sui";
    if (c !== "sui") throw new UnsupportedChainError(c, "sui");

    const result = await this.queryGraphQL<{ transaction: SuiTransaction | null }>(
      TX_DETAIL_QUERY,
      { digest: hash },
    );
    if (!result.transaction) {
      throw new NotFoundError(`Sui transaction ${hash}`, "sui");
    }

    return mapTx(result.transaction);
  }

  override async getGasData(chain?: Chain): Promise<GasData> {
    const c = chain ?? "sui";
    if (c !== "sui") throw new UnsupportedChainError(c, "sui");

    const result = await this.queryGraphQL<{ epoch: { referenceGasPrice: string } | null }>(
      GAS_QUERY,
    );
    if (!result.epoch) {
      throw new NotFoundError("current Sui epoch", "sui");
    }

    return {
      chain: "sui",
      unit: "MIST",
      safeGasPrice: result.epoch.referenceGasPrice,
      proposedGasPrice: result.epoch.referenceGasPrice,
      fastGasPrice: result.epoch.referenceGasPrice,
    };
  }

  override async getBlockInfo(blockNumber: number, chain?: Chain): Promise<BlockInfo> {
    const c = chain ?? "sui";
    if (c !== "sui") throw new UnsupportedChainError(c, "sui");

    const result = await this.queryGraphQL<{
      checkpoint: SuiCheckpoint | null;
      previous: { networkTotalTransactions: number } | null;
    }>(CHECKPOINT_QUERY, {
      number: blockNumber,
      previous: Math.max(0, blockNumber - 1),
    });
    if (!result.checkpoint) {
      throw new NotFoundError(`Sui checkpoint ${blockNumber}`, "sui");
    }

    const previousTotal = blockNumber === 0 ? 0 : (result.previous?.networkTotalTransactions ?? 0);

    return {
      number: result.checkpoint.sequenceNumber,
      hash: result.checkpoint.digest,
      parentHash: result.checkpoint.previousCheckpointDigest ?? "",
      timestamp: result.checkpoint.timestamp,
      miner: "",
      gasUsed: (
        BigInt(result.checkpoint.rollingGasSummary.computationCost) +
        BigInt(result.checkpoint.rollingGasSummary.storageCost)
      ).toString(),
      gasLimit: "0",
      txCount: result.checkpoint.networkTotalTransactions - previousTotal,
    };
  }
}

register(Sui, DEFAULT_BASE);
