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
import { assertSafePathSegment } from "../core/path-safety.js";
import { clampMaxResults, formatWei } from "../core/types.js";

const DEFAULT_BASE = "https://api.blockberry.one/sui";
const SUI_COIN_TYPE = "0x2::sui::SUI";
const ACTIVITY_PAGE_SIZE = 50;

interface BlockberryBalance {
  readonly coinType: string;
  readonly coinSymbol: string;
  readonly balance: string | number;
  readonly decimals: number;
}

interface BlockberryActivity {
  readonly activityType: readonly string[];
  readonly activityWith?: ReadonlyArray<{
    readonly objectType: string;
    readonly id: string;
  }>;
  readonly timestamp: number;
  readonly digest: string;
  readonly txStatus: "SUCCESS" | "FAILURE" | "ABORT";
  readonly gasFee: string | number;
}

interface BlockberryActivityPage {
  readonly content: readonly BlockberryActivity[];
  readonly nextCursor?: string;
}

function mapActivity(raw: Readonly<BlockberryActivity>): Transaction {
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

async function collectActivities(
  limit: number,
  readPage: (size: number, nextCursor: string | undefined) => Promise<BlockberryActivityPage>,
): Promise<BlockberryActivity[]> {
  const activities: BlockberryActivity[] = [];
  const pageLimit = Math.ceil(limit / ACTIVITY_PAGE_SIZE);
  let nextCursor: string | undefined;

  for (let fetches = 0; fetches < pageLimit && activities.length < limit; fetches++) {
    const size = Math.min(ACTIVITY_PAGE_SIZE, limit - activities.length);
    const page = await readPage(size, nextCursor);
    activities.push(...page.content.slice(0, size));
    if (page.content.length < size || !page.nextCursor || page.nextCursor === nextCursor) break;
    nextCursor = page.nextCursor;
  }

  return activities;
}

export class Blockberry extends Provider {
  static readonly key = "blockberry";

  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: Readonly<ProviderConfig>) {
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
    return this.snapshotBalance({
      address,
      chain: "sui",
      balance,
      balanceFormatted: formatWei(balance, decimals),
      symbol: "SUI",
    });
  }

  async getTxHistory(
    address: string,
    chain?: ChainKey,
    options?: Readonly<TxHistoryOptions>,
  ): Promise<Transaction[]> {
    const c = chain ?? "sui";
    if (c !== "sui") throw new UnsupportedChainError(c, this.name);
    assertSafePathSegment(address, "address");

    const limit = options?.limit ? clampMaxResults(options.limit) : ACTIVITY_PAGE_SIZE;
    const activities = await collectActivities(limit, (size, nextCursor) => {
      const query = buildQuery({
        actionType: "ALL",
        nextCursor,
        size,
        orderBy: options?.sort === "asc" ? "ASC" : "DESC",
      });
      return this.api<BlockberryActivityPage>(
        `/v1/accounts/${encodeURIComponent(address)}/activity${query}`,
      );
    });

    return activities.map(mapActivity);
  }
}
