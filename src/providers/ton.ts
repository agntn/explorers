/**
 * TON provider — The Open Network (Telegram blockchain)
 *
 * Public API via tonapi.io, no key needed. TON balance, tx history, tx detail, block info.
 *
 * https://tonapi.io/api-docs
 */

import type {
  ProviderCapabilities,
  ProviderConfig,
  ChainKey,
  Balance,
  Transaction,
  TxHistoryOptions,
  TokenTransfer,
  TxStatus,
} from "../core/types.ts";
import { Provider } from "../core/provider.ts";
import { buildQuery, normalizeBaseUrl } from "../core/client.ts";
import { UnsupportedChainError } from "../core/errors.ts";
import { formatWei, historyPage } from "../core/types.ts";

import { assertSafePathSegment } from "../core/path-safety.ts";
const DEFAULT_BASE = "https://tonapi.io";

/** Largest page of events the account events endpoint returns. */
const HISTORY_PAGE_SIZE = 100;

/** A history read walks at most this many rows, 10 `before_lt` pages, to reach its page. */
const HISTORY_ROWS = 1000;

interface TonAccount {
  readonly address: string;
  readonly balance: string | number;
  readonly status: string;
  readonly last_activity: number;
  readonly name?: string;
  readonly is_scam?: boolean;
  readonly interfaces?: readonly string[];
}

interface TonEvent {
  readonly event_id: string;
  readonly timestamp: number;
  readonly in_progress: boolean;
  readonly actions: ReadonlyArray<{
    readonly type: string;
    readonly TonTransfer?: {
      readonly sender: { readonly address: string };
      readonly recipient: { readonly address: string };
      readonly amount: string | number;
      readonly comment?: string;
    };
    readonly JettonTransfer?: {
      readonly sender: { readonly address: string };
      readonly recipient: { readonly address: string };
      readonly senders_wallet: string;
      readonly recipients_wallet: string;
      readonly amount: string;
      readonly jetton: {
        readonly address: string;
        readonly name: string;
        readonly symbol: string;
        readonly decimals: number;
      };
    };
    readonly status: string;
  }>;
  readonly involved: Readonly<Record<string, unknown>>;
}

/** One page of account events; `next_from` is the `lt` of its last event, `0` at the end. */
interface TonEventPage {
  readonly events?: readonly TonEvent[];
  readonly next_from?: number | string;
}

/**
 * Read the `before_lt` cursor of the next page, if there is one.
 *
 * @param {Readonly<TonEventPage>} page - The page the cursor comes from.
 * @returns {string | undefined} The cursor, or `undefined` once the history ends.
 */
function nextFrom(page: Readonly<TonEventPage>): string | undefined {
  const cursor = String(page.next_from ?? 0);
  return cursor === "0" ? undefined : cursor;
}

function eventStatus(event: Readonly<TonEvent>): TxStatus {
  if (event.in_progress) return "pending";
  return event.actions[0]?.status === "ok" ? "success" : "failed";
}

function mapEventToTx(event: Readonly<TonEvent>): Transaction {
  const firstAction = event.actions[0];
  const timestamp = new Date(event.timestamp * 1000).toISOString();
  let from = "";
  let to: string | null = null;
  let value: string | number = 0;

  if (firstAction?.TonTransfer) {
    from = firstAction.TonTransfer.sender.address;
    to = firstAction.TonTransfer.recipient.address;
    value = firstAction.TonTransfer.amount;
  } else if (firstAction?.JettonTransfer) {
    from = firstAction.JettonTransfer.sender.address;
    to = firstAction.JettonTransfer.recipient.address;
  }

  const tokenTransfers: TokenTransfer[] = event.actions.flatMap((action) => {
    const transfer = action.JettonTransfer;
    if (!transfer || action.status !== "ok") return [];
    return [
      {
        contract: transfer.jetton.address,
        symbol: transfer.jetton.symbol,
        name: transfer.jetton.name,
        decimals: transfer.jetton.decimals,
        value: transfer.amount,
        valueFormatted: formatWei(transfer.amount, transfer.jetton.decimals),
        from: transfer.sender.address,
        to: transfer.recipient.address,
        txHash: event.event_id,
        blockNumber: 0,
        timestamp,
      },
    ];
  });

  return {
    hash: event.event_id,
    blockNumber: 0,
    timestamp,
    from,
    to,
    value: value.toString(),
    valueFormatted: formatWei(String(value), 9),
    status: eventStatus(event),
    isContractInteraction: firstAction?.type !== "TonTransfer",
    tokenTransfers,
  };
}

export class Ton extends Provider {
  static readonly key = "ton";

  private baseUrl: string;

  constructor(config: Readonly<ProviderConfig>) {
    super(config);
    this.baseUrl = normalizeBaseUrl(config.baseUrl ?? DEFAULT_BASE);
  }
  get capabilities(): ProviderCapabilities {
    return {
      balances: true,
      txHistory: true,
      txDetail: false,
      utxos: false,
      contractInfo: false,
      tokenBalances: false,
      tokenTransfers: false,
      gasData: false,
      blockInfo: false,
    };
  }

  async getBalance(address: string, chain?: ChainKey): Promise<Balance> {
    const c = chain ?? "ton";
    if (c !== "ton") throw new UnsupportedChainError(c, "ton");

    assertSafePathSegment(address, "address");
    const data = await this.getJSON<TonAccount>(
      `${this.baseUrl}/v2/accounts/${encodeURIComponent(address)}`,
    );

    return this.snapshotBalance({
      address,
      chain: "ton",
      balance: data.balance.toString(),
      balanceFormatted: formatWei(String(data.balance), 9),
      symbol: "TON",
    });
  }

  async getTxHistory(
    address: string,
    chain?: ChainKey,
    options?: Readonly<TxHistoryOptions>,
  ): Promise<Transaction[]> {
    const c = chain ?? "ton";
    if (c !== "ton") throw new UnsupportedChainError(c, "ton");
    const { limit, offset } = historyPage(options, HISTORY_ROWS, this.name);
    const rows = offset + limit;

    assertSafePathSegment(address, "address");
    const url = `${this.baseUrl}/v2/accounts/${encodeURIComponent(address)}/events`;
    const events: TonEvent[] = [];
    let beforeLt: string | undefined;
    while (events.length < rows) {
      const size = Math.min(HISTORY_PAGE_SIZE, rows - events.length);
      const data = await this.getJSON<TonEventPage>(
        `${url}${buildQuery({ limit: size, before_lt: beforeLt })}`,
      );
      const page = data.events ?? [];
      events.push(...page);
      const cursor = nextFrom(data);
      if (page.length < size || cursor === undefined || cursor === beforeLt) break;
      beforeLt = cursor;
    }

    return events.slice(offset, rows).map(mapEventToTx);
  }
}
