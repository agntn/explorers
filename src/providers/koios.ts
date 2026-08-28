/**
 * Koios provider - the Cardano REST API the community runs.
 *
 * The public instance answers without a key. Balances, transaction history and detail, and the
 * native assets an address holds.
 *
 * https://api.koios.rest
 */

import type {
  Balance,
  ChainKey,
  ProviderCapabilities,
  ProviderConfig,
  TokenBalance,
  TokenBalanceOptions,
  Transaction,
  TxHistoryOptions,
} from "../core/types.js";
import { Provider } from "../core/provider.js";
import { buildQuery, normalizeBaseUrl } from "../core/client.js";
import { NotFoundError, UnsupportedChainError } from "../core/errors.js";
import { create as createChain } from "@agntn/chains";
import { clampMaxResults, formatWei, toTimestamp } from "../core/types.js";

const DEFAULT_BASE = "https://api.koios.rest/api/v1";

/** Every ADA amount Koios reports is denominated in lovelace. */
const ADA_DECIMALS = 6;

/** Hashes per `tx_info` call. A body over 5120 bytes is refused and one hash costs 67 of them. */
const TX_INFO_BATCH = 70;

/** Assets per `address_assets` page. */
const ASSET_PAGE_LIMIT = 1000;

/** Pages the holdings walk visits, so one address cannot fan out unbounded requests. */
const ASSET_MAX_PAGES = 20;

/** Characters that hide, forge a line, or reorder one. A minter picks an asset name freely. */
const UNPRINTABLE = /[\p{C}\p{Zl}\p{Zp}]/u;

interface KoiosAddressInfo {
  address: string;
  balance: string | number;
}

interface KoiosAddressTx {
  tx_hash: string;
  epoch_no: number;
  block_height: number;
  block_time: number;
}

interface KoiosAsset {
  policy_id: string;
  asset_name: string | null;
  fingerprint: string;
  decimals: number | null;
  quantity: string | number;
}

/** One side of a transaction. Koios gives inputs and outputs the same shape. */
interface KoiosTxIo {
  value: string | number;
  payment_addr?: { bech32: string };
}

interface KoiosTxInfo {
  tx_hash: string;
  block_height: number;
  tx_timestamp: number;
  total_output: string | number;
  fee: string | number;
  inputs: KoiosTxIo[];
  outputs: KoiosTxIo[];
  collateral_inputs: KoiosTxIo[];
}

/** ADA's supply in lovelace runs past `Number.MAX_SAFE_INTEGER`, so sums are taken in BigInt. */
function lovelace(value: string | number): bigint {
  return BigInt(String(value));
}

/** Sum the sides of a transaction that belong to one address. */
function sumFor(sides: KoiosTxIo[], address: string): bigint {
  return sides.reduce(
    (total, side) => (side.payment_addr?.bech32 === address ? total + lovelace(side.value) : total),
    0n,
  );
}

let utf8: TextDecoder | undefined;

function decoder(): TextDecoder {
  utf8 ??= new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  return utf8;
}

/** Read an asset name as text. A minter picks those bytes, so anything invisible stays unread. */
function decodeAssetName(hex: string | null): string | undefined {
  if (!hex || !/^(?:[0-9a-fA-F]{2})+$/.test(hex)) return undefined;
  const bytes = Uint8Array.from(hex.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));
  try {
    const text = decoder().decode(bytes);
    return UNPRINTABLE.test(text) ? undefined : text;
  } catch {
    return undefined;
  }
}

/** Read one holding. The CIP-14 fingerprint names an asset whose own name is bytes, not text. */
function mapTokenBalance(asset: KoiosAsset): TokenBalance {
  const decimals = asset.decimals ?? 0;
  const balance = String(asset.quantity);

  return {
    contract: `${asset.policy_id}${asset.asset_name ?? ""}`,
    symbol: decodeAssetName(asset.asset_name) ?? asset.fingerprint,
    decimals,
    balance,
    balanceFormatted: formatWei(balance, decimals),
  };
}

/** The transaction as a whole: who paid in first, who was paid first, and how much left it. */
function wholeTx(raw: KoiosTxInfo): { from: string; to: string | null; value: bigint } {
  return {
    from: raw.inputs[0]?.payment_addr?.bech32 ?? "unknown",
    to: raw.outputs[0]?.payment_addr?.bech32 ?? null,
    value: lovelace(raw.total_output),
  };
}

/**
 * The same transaction seen from one address: what it sent or received, and its counterparty.
 *
 * Change returns to the sender, so what left is the shortfall minus the fee; an address that funded
 * the transaction and still came out ahead reports the gain.
 */
function addressView(
  raw: KoiosTxInfo,
  address: string,
): { from: string; to: string | null; value: bigint } {
  const paidIn = sumFor(raw.inputs, address);
  const received = sumFor(raw.outputs, address);
  const isSend = paidIn > 0n;
  const net = received - paidIn;
  const moved = net < 0n ? -net - lovelace(raw.fee) : net;

  return {
    from: isSend ? address : (raw.inputs[0]?.payment_addr?.bech32 ?? "unknown"),
    to: isSend
      ? (raw.outputs.find((output) => output.payment_addr?.bech32 !== address)?.payment_addr
          ?.bech32 ?? address)
      : address,
    value: moved > 0n ? moved : 0n,
  };
}

/**
 * Read one transaction, from the point of view of `address` when the caller has one.
 *
 * Many inputs spend into many outputs, so one from/to pair is a summary. Collateral is what marks a
 * contract call, and the phase-2 validity flag sits behind the heavier `_scripts` payload, so even
 * a script that failed and lost its collateral reads as `success`.
 */
function mapTransaction(raw: KoiosTxInfo, address?: string): Transaction {
  const { from, to, value } = address === undefined ? wholeTx(raw) : addressView(raw, address);

  return {
    hash: raw.tx_hash,
    blockNumber: raw.block_height,
    timestamp: toTimestamp(raw.tx_timestamp),
    from,
    to,
    value: value.toString(),
    valueFormatted: formatWei(value, ADA_DECIMALS),
    fee: String(raw.fee),
    status: "success",
    isContractInteraction: raw.collateral_inputs.length > 0,
    tokenTransfers: [],
    raw: raw as unknown as Record<string, unknown>,
  };
}

export class Koios extends Provider {
  static readonly key = "koios";

  private readonly baseUrl: string;

  constructor(config: ProviderConfig) {
    super(config);
    this.baseUrl = normalizeBaseUrl(config.baseUrl ?? DEFAULT_BASE);
  }

  get capabilities(): ProviderCapabilities {
    return {
      balances: true,
      txHistory: true,
      txDetail: true,
      contractInfo: false,
      tokenBalances: true,
      tokenTransfers: false,
      gasData: false,
      blockInfo: false,
    };
  }

  /** Post to a Koios endpoint. Addresses and hashes ride in the body, so none reach the path. */
  private post<T>(
    path: string,
    body: unknown,
    params: Record<string, string | number | undefined> = {},
  ): Promise<T> {
    return this.postJSON<T>(`${this.baseUrl}${path}${buildQuery(params)}`, body);
  }

  private assertChain(chain?: ChainKey): ChainKey {
    const c = chain ?? "cardano";
    if (c !== "cardano") throw new UnsupportedChainError(c, this.name);
    return c;
  }

  /** Read full transactions in batches the body limit allows. */
  private async txInfo(hashes: string[]): Promise<KoiosTxInfo[]> {
    const details: KoiosTxInfo[] = [];
    for (let start = 0; start < hashes.length; start += TX_INFO_BATCH) {
      const page = await this.post<KoiosTxInfo[]>("/tx_info", {
        _tx_hashes: hashes.slice(start, start + TX_INFO_BATCH),
        _inputs: true,
      });
      details.push(...page);
    }
    return details;
  }

  /**
   * Read the ADA balance. Without `select` the endpoint also ships the whole UTxO set, 222 kB of
   * it, and an address the ledger never saw answers with an empty array just like a malformed one.
   */
  async getBalance(address: string, chain?: ChainKey): Promise<Balance> {
    const c = this.assertChain(chain);

    const [info] = await this.post<KoiosAddressInfo[]>(
      "/address_info",
      { _addresses: [address] },
      { select: "address,balance" },
    );
    if (!info) throw new NotFoundError(address, this.name);

    const balance = String(info.balance);
    return this.snapshotBalance({
      address,
      chain: c,
      balance,
      balanceFormatted: formatWei(balance, ADA_DECIMALS),
      symbol: createChain(c).symbol,
    });
  }

  /** List transactions. `tx_info` answers in its own order, so the hash list sets the order. */
  async getTxHistory(
    address: string,
    chain?: ChainKey,
    options?: TxHistoryOptions,
  ): Promise<Transaction[]> {
    this.assertChain(chain);

    const limit = clampMaxResults(options?.limit);
    const page = Math.max(1, Math.round(options?.page ?? 1));
    const rows = await this.post<KoiosAddressTx[]>(
      "/address_txs",
      { _addresses: [address], _after_block_height: options?.startBlock },
      {
        limit,
        offset: (page - 1) * limit || undefined,
        order: `block_height.${options?.sort === "asc" ? "asc" : "desc"}`,
        block_height: options?.endBlock === undefined ? undefined : `lte.${options.endBlock}`,
      },
    );
    if (rows.length === 0) return [];

    const details = await this.txInfo(rows.map((row) => row.tx_hash));
    const byHash = new Map(details.map((detail) => [detail.tx_hash, detail]));

    return rows.flatMap((row) => {
      const detail = byHash.get(row.tx_hash);
      return detail ? [mapTransaction(detail, address)] : [];
    });
  }

  override async getTxDetail(hash: string, chain?: ChainKey): Promise<Transaction> {
    this.assertChain(chain);

    const [detail] = await this.txInfo([hash]);
    if (!detail) throw new NotFoundError(hash, this.name);
    return mapTransaction(detail);
  }

  /** List the native assets an address holds. A single NFT project can fill several pages. */
  override async getTokenBalances(
    address: string,
    chain?: ChainKey,
    options?: TokenBalanceOptions,
  ): Promise<TokenBalance[]> {
    this.assertChain(chain);

    const tokens: TokenBalance[] = [];
    for (let page = 0; page < ASSET_MAX_PAGES; page++) {
      const assets = await this.post<KoiosAsset[]>(
        "/address_assets",
        { _addresses: [address] },
        { limit: ASSET_PAGE_LIMIT, offset: page * ASSET_PAGE_LIMIT || undefined },
      );
      tokens.push(...assets.map(mapTokenBalance));
      if (assets.length < ASSET_PAGE_LIMIT) break;
    }

    return options?.nonZeroOnly ? tokens.filter((token) => token.balance !== "0") : tokens;
  }
}
