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
  Chain,
  Balance,
  Transaction,
  TxHistoryOptions,
  TokenTransfer,
  TxStatus,
} from "../core/types.js";
import { Provider } from "../core/provider.js";
import { normalizeBaseUrl } from "../core/client.js";
import { UnsupportedChainError } from "../core/errors.js";
import { register } from "../core/registry.js";
import { clampMaxResults, formatWei } from "../core/types.js";

import { assertSafePathSegment } from "../core/path-safety.js";
const DEFAULT_BASE = "https://tonapi.io";

interface TonAccount {
  address: string;
  balance: string | number;
  status: string;
  last_activity: number;
  name?: string;
  is_scam?: boolean;
  interfaces?: string[];
}

interface TonEvent {
  event_id: string;
  timestamp: number;
  actions: Array<{
    type: string;
    TonTransfer?: {
      sender: { address: string };
      recipient: { address: string };
      amount: string | number;
      comment?: string;
    };
    JettonTransfer?: {
      sender: { address: string };
      recipient: { address: string };
      senders_wallet: string;
      recipients_wallet: string;
      amount: string;
      jetton: { address: string; name: string; symbol: string; decimals: number };
    };
    status: string;
  }>;
  involved: Record<string, unknown>;
}

function mapEventToTx(event: TonEvent): Transaction {
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
    if (!transfer) return [];
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
    status: (firstAction?.status === "ok" ? "success" : "failed") as TxStatus,
    isContractInteraction: firstAction?.type !== "TonTransfer",
    tokenTransfers,
  };
}

class Ton extends Provider {
  static readonly key = "ton";

  private baseUrl: string;

  constructor(config: ProviderConfig) {
    super(config);
    this.baseUrl = normalizeBaseUrl(config.baseUrl ?? DEFAULT_BASE);
  }
  get capabilities(): ProviderCapabilities {
    return {
      balances: true,
      txHistory: true,
      txDetail: false,
      contractInfo: false,
      tokenBalances: false,
      gasData: false,
      blockInfo: false,
    };
  }

  async getBalance(address: string, chain?: Chain): Promise<Balance> {
    const c = chain ?? "ton";
    if (c !== "ton") throw new UnsupportedChainError(c, "ton");

    assertSafePathSegment(address, "address");
    const data = await this.getJSON<TonAccount>(
      `${this.baseUrl}/v2/accounts/${encodeURIComponent(address)}`,
    );

    return {
      address,
      chain: "ton",
      balance: data.balance.toString(),
      balanceFormatted: formatWei(String(data.balance), 9),
      symbol: "TON",
    };
  }

  async getTxHistory(
    address: string,
    chain?: Chain,
    options?: TxHistoryOptions,
  ): Promise<Transaction[]> {
    const c = chain ?? "ton";
    if (c !== "ton") throw new UnsupportedChainError(c, "ton");
    const limit = clampMaxResults(options?.limit);

    assertSafePathSegment(address, "address");
    const data = await this.getJSON<{ events: TonEvent[] }>(
      `${this.baseUrl}/v2/accounts/${encodeURIComponent(address)}/events?limit=${limit}`,
    );

    if (!data.events?.length) return [];

    return data.events.map(mapEventToTx);
  }
}

register(Ton, "https://tonapi.io");
