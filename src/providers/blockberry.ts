/**
 * Blockberry provider — indexed Sui data used by the Suiscan explorer.
 *
 * https://docs.blockberry.one/reference/sui-quickstart
 */

import type {
  Balance,
  ChainKey,
  ProviderCapabilities,
  ProviderConfig,
  Transaction,
  TxHistoryOptions,
  TxStatus,
} from "../core/types.js";
import { Provider } from "../core/provider.js";
import { normalizeBaseUrl, buildQuery } from "../core/client.js";
import { AuthError, UnsupportedChainError } from "../core/errors.js";
import { register } from "../core/registry.js";
import { assertSafePathSegment } from "../core/path-safety.js";
import { clampMaxResults, formatWei } from "../core/types.js";

const DEFAULT_BASE = "https://api.blockberry.one/sui";
const SUI_COIN_TYPE = "0x2::sui::SUI";

interface BlockberryBalance {
  coinType: string;
  coinSymbol: string;
  balance: string | number;
  decimals: number;
}

interface BlockberryActivity {
  activityType: string[];
  activityWith?: Array<{
    objectType: string;
    id: string;
  }>;
  timestamp: number;
  digest: string;
  txStatus: "SUCCESS" | "FAILURE" | "ABORT";
  gasFee: string | number;
}

interface BlockberryActivityPage {
  content: BlockberryActivity[];
  nextCursor?: string;
}

function mapActivity(raw: BlockberryActivity): Transaction {
  const counterparty = raw.activityWith?.find((item) => item.objectType === "ACCOUNT")?.id;
  return {
    hash: raw.digest,
    blockNumber: 0,
    timestamp: new Date(raw.timestamp).toISOString(),
    from: counterparty ?? "",
    to: null,
    value: "0",
    valueFormatted: "0",
    fee: String(raw.gasFee),
    status: (raw.txStatus === "SUCCESS" ? "success" : "failed") as TxStatus,
    isContractInteraction: raw.activityType.some((type) => type !== "TRANSFER"),
    tokenTransfers: [],
    raw: raw as unknown as Record<string, unknown>,
  };
}

class Blockberry extends Provider {
  static readonly key = "blockberry";
  static readonly chains: readonly ChainKey[] = ["sui"];

  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: ProviderConfig) {
    super(config);
    const apiKey = config.apiKey ?? process.env.BLOCKBERRY_API_KEY ?? "";
    if (!apiKey) {
      throw new AuthError("blockberry", "Set BLOCKBERRY_API_KEY or pass apiKey in config");
    }
    this.apiKey = apiKey;
    this.baseUrl = normalizeBaseUrl(config.baseUrl ?? DEFAULT_BASE);
  }
  get capabilities(): ProviderCapabilities {
    return {
      balances: true,
      txHistory: true,
      txDetail: false,
      contractInfo: false,
      tokenBalances: false,
      tokenTransfers: false,
      gasData: false,
      blockInfo: false,
    };
  }

  private api<T>(path: string): Promise<T> {
    return this.getJSON<T>(`${this.baseUrl}${path}`, {
      headers: { "x-api-key": this.apiKey },
    });
  }

  async getBalance(address: string, chain?: ChainKey): Promise<Balance> {
    const c = chain ?? "sui";
    if (c !== "sui") throw new UnsupportedChainError(c, this.name);
    assertSafePathSegment(address, "address");

    const balances = await this.api<BlockberryBalance[]>(
      `/v1/accounts/${encodeURIComponent(address)}/balance`,
    );
    const sui = balances.find(
      (balance) => balance.coinType === SUI_COIN_TYPE || balance.coinSymbol === "SUI",
    );
    const balance = String(sui?.balance ?? 0);
    const decimals = sui?.decimals ?? 9;
    return {
      address,
      chain: "sui",
      balance,
      balanceFormatted: formatWei(balance, decimals),
      symbol: "SUI",
    };
  }

  async getTxHistory(
    address: string,
    chain?: ChainKey,
    options?: TxHistoryOptions,
  ): Promise<Transaction[]> {
    const c = chain ?? "sui";
    if (c !== "sui") throw new UnsupportedChainError(c, this.name);
    assertSafePathSegment(address, "address");

    const query = buildQuery({
      actionType: "ALL",
      size: clampMaxResults(options?.limit, 50),
      orderBy: options?.sort === "asc" ? "ASC" : "DESC",
    });
    const page = await this.api<BlockberryActivityPage>(
      `/v1/accounts/${encodeURIComponent(address)}/activity${query}`,
    );
    return page.content.map(mapActivity);
  }
}

register(Blockberry, DEFAULT_BASE);
