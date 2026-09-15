import { formatWei, getJSON, type ChainKey } from "@agntn/explorers";
import type {
  BlockTransaction,
  BlockTransactionsAnswer,
  TipAnswer,
  TipBlock,
  TipStat,
  TipTransaction,
} from "#shared/wire";
import { groupDigits } from "../../app/utils/format";
import { chainInfo, nativeDecimals } from "../../app/utils/providers";

/**
 * The tip of a chain: height, network stats, the latest blocks and the latest transactions.
 *
 * The library reads one address, one hash or one block; it has no "latest" read yet, and a block
 * explorer without a live feed is a search box. So the worker asks the same public explorer APIs
 * the keyless providers use, through the library's own `getJSON`, for the few list endpoints the
 * providers do not wrap. Hosts mirror `CHAIN_BASES` in `src/providers/blockscout.ts` and
 * `src/providers/mempool.ts` and cover exactly `TIP_CHAINS` in `shared/tip-chains.ts`; when the
 * library grows a tip read, this file goes away.
 */

/** The public Blockscout instance per chain, as `src/providers/blockscout.ts` has them. */
const BLOCKSCOUT: Partial<Record<ChainKey, string>> = {
  ethereum: "https://eth.blockscout.com",
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

/** The Esplora hosts per chain, as `src/providers/mempool.ts` has them. */
const MEMPOOL: Partial<Record<ChainKey, string>> = {
  bitcoin: "https://mempool.space",
  litecoin: "https://litecoinspace.org",
  pepecoin: "https://peppool.space",
};

const ARWEAVE = "https://arweave.net";

const LIMIT = 10;

function iso(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

function symbolOf(chain: ChainKey): string {
  return chainInfo(chain)?.symbol ?? chain.toUpperCase();
}

/* Blockscout */

interface BlockscoutStats {
  total_blocks?: string;
  total_transactions?: string;
  transactions_today?: string;
  average_block_time?: number;
  coin_price?: string | null;
  network_utilization_percentage?: number;
  gas_prices?: { slow?: number; average?: number; fast?: number } | null;
}

interface BlockscoutBlock {
  height: number;
  hash: string;
  timestamp: string;
  transactions_count?: number | null;
  miner?: { hash?: string } | null;
  gas_used?: string | null;
  gas_limit?: string | null;
  size?: number | null;
}

interface BlockscoutTx {
  hash: string;
  from?: { hash?: string } | null;
  to?: { hash?: string } | null;
  value?: string | null;
  fee?: { value?: string | null } | null;
  timestamp?: string | null;
  block_number?: number | null;
  status?: string | null;
  method?: string | null;
}

function blockscoutStatus(status: string | null | undefined): TipTransaction["status"] {
  if (status === "ok") return "success";
  if (status === "error") return "failed";
  return "pending";
}

/** One Blockscout transaction row as the feed and the block list both show it. */
function blockscoutTx(tx: BlockscoutTx, chain: ChainKey): BlockTransaction {
  return {
    hash: tx.hash,
    from: tx.from?.hash ?? null,
    to: tx.to?.hash ?? null,
    value: tx.value ?? "0",
    valueFormatted: formatWei(tx.value ?? "0", nativeDecimals(chain)),
    fee: tx.fee?.value ?? null,
    status: blockscoutStatus(tx.status),
    method: tx.method ?? null,
  };
}

async function blockscoutTip(chain: ChainKey, base: string): Promise<TipAnswer> {
  const [stats, blocks, transactions] = await Promise.all([
    getJSON<BlockscoutStats>(`${base}/api/v2/stats`, { provider: "blockscout" }),
    getJSON<{ items: BlockscoutBlock[] }>(`${base}/api/v2/blocks?type=block`, {
      provider: "blockscout",
    }),
    getJSON<{ items: BlockscoutTx[] }>(`${base}/api/v2/transactions?filter=validated`, {
      provider: "blockscout",
    }),
  ]);
  const symbol = symbolOf(chain);
  const tiles: TipStat[] = [];
  const height = blocks.items[0]?.height ?? Number(stats.total_blocks ?? 0);
  tiles.push({ label: "latest block", value: groupDigits(String(height)) });
  if (stats.average_block_time)
    tiles.push({ label: "block time", value: `${(stats.average_block_time / 1000).toFixed(1)} s` });
  if (stats.total_transactions)
    tiles.push({
      label: "transactions",
      value: groupDigits(stats.total_transactions),
      hint: stats.transactions_today ? `${groupDigits(stats.transactions_today)} today` : undefined,
    });
  if (stats.gas_prices?.average !== undefined && stats.gas_prices.average !== null)
    tiles.push({
      label: "gas",
      value: `${stats.gas_prices.average} gwei`,
      hint:
        stats.gas_prices.slow !== undefined && stats.gas_prices.fast !== undefined
          ? `${stats.gas_prices.slow} slow · ${stats.gas_prices.fast} fast`
          : undefined,
    });
  if (typeof stats.network_utilization_percentage === "number")
    tiles.push({ label: "utilization", value: `${stats.network_utilization_percentage.toFixed(1)}%` });
  if (stats.coin_price) tiles.push({ label: `${symbol} price`, value: `$${stats.coin_price}` });
  return {
    chain,
    source: "blockscout",
    height,
    symbol,
    feeUnit: null,
    stats: tiles,
    blocks: blocks.items.slice(0, LIMIT).map((block) => ({
      number: block.height,
      hash: block.hash,
      timestamp: block.timestamp,
      txCount: block.transactions_count ?? 0,
      miner: block.miner?.hash ?? null,
      producer: null,
      gasUsed: block.gas_used ?? null,
      gasLimit: block.gas_limit ?? null,
      size: block.size ?? null,
    })),
    transactions: transactions.items.slice(0, LIMIT).map((tx) => ({
      ...blockscoutTx(tx, chain),
      timestamp: tx.timestamp ?? null,
      blockNumber: tx.block_number ?? null,
    })),
    fetchedAt: new Date().toISOString(),
  };
}

/* Mempool family */

interface MempoolBlock {
  id: string;
  height: number;
  timestamp: number;
  tx_count: number;
  size: number;
  extras?: { pool?: { name?: string } | null; totalFees?: number; medianFee?: number } | null;
}

interface MempoolRecent {
  txid: string;
  fee: number;
  vsize: number;
  value: number;
}

interface MempoolInfo {
  count?: number;
  vsize?: number;
  total_fee?: number;
}

interface MempoolFees {
  fastestFee?: number;
  halfHourFee?: number;
  hourFee?: number;
}

async function mempoolTip(chain: ChainKey, base: string): Promise<TipAnswer> {
  /** Peppool has no v1 block list; the plain list lacks pool names and that is all it lacks. */
  const blocksPath = chain === "pepecoin" ? "/api/blocks" : "/api/v1/blocks";
  const [blocks, recent, info, fees] = await Promise.all([
    getJSON<MempoolBlock[]>(`${base}${blocksPath}`, { provider: "mempool" }),
    getJSON<MempoolRecent[]>(`${base}/api/mempool/recent`, { provider: "mempool" }).catch(
      () => [] as MempoolRecent[],
    ),
    getJSON<MempoolInfo>(`${base}/api/mempool`, { provider: "mempool" }).catch((): MempoolInfo => ({})),
    chain === "pepecoin"
      ? Promise.resolve<MempoolFees>({})
      : getJSON<MempoolFees>(`${base}/api/v1/fees/recommended`, { provider: "mempool" }).catch(
          (): MempoolFees => ({}),
        ),
  ]);
  const symbol = symbolOf(chain);
  const decimals = nativeDecimals(chain);
  const smallest = chain === "litecoin" ? "litoshi" : "sat";
  const unit = `${smallest}/vB`;
  const tiles: TipStat[] = [];
  const tip = blocks[0];
  if (tip) tiles.push({ label: "latest block", value: groupDigits(String(tip.height)) });
  if (blocks.length > 1 && tip) {
    const span = tip.timestamp - blocks[blocks.length - 1]!.timestamp;
    tiles.push({ label: "block time", value: `${(span / (blocks.length - 1) / 60).toFixed(1)} min` });
  }
  if (info.count !== undefined)
    tiles.push({
      label: "mempool",
      value: `${groupDigits(String(info.count))} tx`,
      hint: info.vsize !== undefined ? `${(info.vsize / 1_000_000).toFixed(1)} MvB` : undefined,
    });
  if (fees.halfHourFee !== undefined)
    tiles.push({
      label: "fee",
      value: `${fees.halfHourFee} ${unit}`,
      hint:
        fees.hourFee !== undefined && fees.fastestFee !== undefined
          ? `${fees.hourFee} slow · ${fees.fastestFee} fast`
          : undefined,
    });
  if (tip?.extras?.totalFees !== undefined)
    tiles.push({
      label: "fees in tip",
      value: `${formatWei(String(tip.extras.totalFees), decimals)} ${symbol}`,
    });
  return {
    chain,
    source: "mempool",
    height: tip?.height ?? 0,
    symbol,
    feeUnit: smallest,
    stats: tiles,
    blocks: blocks.slice(0, LIMIT).map((block) => ({
      number: block.height,
      hash: block.id,
      timestamp: iso(block.timestamp),
      txCount: block.tx_count,
      miner: null,
      producer: block.extras?.pool?.name ?? null,
      gasUsed: null,
      gasLimit: null,
      size: block.size,
    })),
    /** Unconfirmed transactions have no block and no time yet; the mempool list is what the explorer shows too. */
    transactions: recent.slice(0, LIMIT).map((tx) => ({
      hash: tx.txid,
      from: null,
      to: null,
      value: String(tx.value),
      valueFormatted: formatWei(String(tx.value), decimals),
      fee: String(tx.fee),
      timestamp: null,
      blockNumber: null,
      status: "pending",
      method: `${tx.vsize} vB`,
    })),
    fetchedAt: new Date().toISOString(),
  };
}

/* Arweave gateway */

interface ArweaveInfo {
  height: number;
  blocks?: number;
  peers?: number;
}

interface ArweaveBlock {
  height: number;
  timestamp: number;
  indep_hash: string;
  reward_addr?: string;
  txs?: string[];
  block_size?: string;
  weave_size?: string;
}

interface ArweaveEdge {
  node: {
    id: string;
    owner: { address: string };
    recipient: string;
    quantity: { winston: string };
    fee: { winston: string };
    block: { height: number; timestamp: number } | null;
  };
}

async function arweaveTip(): Promise<TipAnswer> {
  const [info, current] = await Promise.all([
    getJSON<ArweaveInfo>(`${ARWEAVE}/info`, { provider: "arweave" }),
    getJSON<ArweaveBlock>(`${ARWEAVE}/block/current`, { provider: "arweave" }),
  ]);
  const query = `{ transactions(first: ${LIMIT}, sort: HEIGHT_DESC) { edges { node { id owner { address } recipient quantity { winston } fee { winston } block { height timestamp } } } } }`;
  const graph = await $fetch<{ data?: { transactions?: { edges?: ArweaveEdge[] } } }>(
    `${ARWEAVE}/graphql`,
    { method: "POST", body: { query }, retry: 0 },
  ).catch(() => ({ data: { transactions: { edges: [] as ArweaveEdge[] } } }));
  /** The gateway lists one block at a time; walking back a few heights gives a short feed. */
  const heights = Array.from({ length: 5 }, (_, index) => current.height - index - 1);
  const older = await Promise.all(
    heights.map((height) =>
      getJSON<ArweaveBlock>(`${ARWEAVE}/block/height/${height}`, { provider: "arweave" }).catch(
        () => null,
      ),
    ),
  );
  const blocks = [current, ...older.filter((block): block is ArweaveBlock => block !== null)];
  const tiles: TipStat[] = [
    { label: "latest block", value: groupDigits(String(info.height)) },
    { label: "block time", value: "~2 min", hint: "network target" },
  ];
  if (current.weave_size)
    tiles.push({
      label: "weave size",
      value: `${(Number(current.weave_size) / 1e12).toFixed(1)} TB`,
    });
  if (info.peers !== undefined) tiles.push({ label: "peers", value: String(info.peers) });
  return {
    chain: "arweave",
    source: "arweave",
    height: info.height,
    symbol: symbolOf("arweave"),
    feeUnit: "winston",
    stats: tiles,
    blocks: blocks.map((block) => ({
      number: block.height,
      hash: block.indep_hash,
      timestamp: iso(block.timestamp),
      txCount: block.txs?.length ?? 0,
      miner: block.reward_addr ?? null,
      producer: null,
      gasUsed: null,
      gasLimit: null,
      size: block.block_size ? Number(block.block_size) : null,
    })),
    transactions: (graph.data?.transactions?.edges ?? []).map(({ node }) => ({
      hash: node.id,
      from: node.owner.address,
      to: node.recipient || null,
      value: node.quantity.winston,
      valueFormatted: formatWei(node.quantity.winston, nativeDecimals("arweave")),
      fee: node.fee.winston,
      timestamp: node.block ? iso(node.block.timestamp) : null,
      blockNumber: node.block?.height ?? null,
      status: node.block ? "success" : "pending",
      method: node.recipient ? null : "data",
    })),
    fetchedAt: new Date().toISOString(),
  };
}

export async function readTip(chain: ChainKey): Promise<TipAnswer> {
  const blockscout = BLOCKSCOUT[chain];
  if (blockscout) return blockscoutTip(chain, blockscout);
  const mempool = MEMPOOL[chain];
  if (mempool) return mempoolTip(chain, mempool);
  if (chain === "arweave") return arweaveTip();
  throw createError({
    statusCode: 404,
    statusMessage: `No live feed for ${chain}: its providers serve one address, hash or block at a time`,
  });
}

/* Transactions inside one block */

interface EsploraTx {
  txid: string;
  fee: number;
  vin: { prevout?: { scriptpubkey_address?: string } | null }[];
  vout: { value: number; scriptpubkey_address?: string }[];
}

const BLOCK_TX_LIMIT = 25;

export async function readBlockTransactions(
  chain: ChainKey,
  number: number,
): Promise<BlockTransactionsAnswer> {
  const blockscout = BLOCKSCOUT[chain];
  if (blockscout) {
    const [block, page] = await Promise.all([
      getJSON<BlockscoutBlock>(`${blockscout}/api/v2/blocks/${number}`, { provider: "blockscout" }),
      getJSON<{ items: BlockscoutTx[] }>(`${blockscout}/api/v2/blocks/${number}/transactions`, {
        provider: "blockscout",
      }),
    ]);
    return {
      chain,
      number,
      source: "blockscout",
      total: block.transactions_count ?? null,
      items: page.items.slice(0, BLOCK_TX_LIMIT).map((tx) => blockscoutTx(tx, chain)),
      fetchedAt: new Date().toISOString(),
    };
  }
  const mempool = MEMPOOL[chain];
  if (mempool) {
    /** The height route answers the hash as plain text, so it bypasses the JSON client. */
    const hash = await $fetch<string>(`${mempool}/api/block-height/${number}`, {
      responseType: "text",
      retry: 0,
    });
    if (!/^[0-9a-f]{64}$/u.test(hash)) {
      throw createError({ statusCode: 404, statusMessage: `No block ${number} on ${chain}` });
    }
    const [block, txs] = await Promise.all([
      getJSON<MempoolBlock>(`${mempool}/api/block/${hash}`, { provider: "mempool" }),
      getJSON<EsploraTx[]>(`${mempool}/api/block/${hash}/txs`, { provider: "mempool" }),
    ]);
    return {
      chain,
      number,
      source: "mempool",
      total: block.tx_count,
      items: txs.slice(0, BLOCK_TX_LIMIT).map((tx) => {
        const value = tx.vout.reduce((sum, out) => sum + out.value, 0);
        return {
          hash: tx.txid,
          from: tx.vin[0]?.prevout?.scriptpubkey_address ?? null,
          to: tx.vout[0]?.scriptpubkey_address ?? null,
          value: String(value),
          valueFormatted: formatWei(String(value), nativeDecimals(chain)),
          fee: String(tx.fee),
          status: "success",
          method: tx.vin[0]?.prevout ? null : "coinbase",
        };
      }),
      fetchedAt: new Date().toISOString(),
    };
  }
  if (chain === "arweave") {
    const block = await getJSON<ArweaveBlock>(`${ARWEAVE}/block/height/${number}`, {
      provider: "arweave",
    });
    const ids = block.txs ?? [];
    return {
      chain,
      number,
      source: "arweave",
      total: ids.length,
      /** The gateway lists ids only; each one is a link to its own page. */
      items: ids.slice(0, BLOCK_TX_LIMIT).map((id) => ({
        hash: id,
        from: null,
        to: null,
        value: "0",
        valueFormatted: "",
        fee: null,
        status: "success",
        method: null,
      })),
      fetchedAt: new Date().toISOString(),
    };
  }
  throw createError({
    statusCode: 404,
    statusMessage: `No block transaction list for ${chain}`,
  });
}
