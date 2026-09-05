import { z } from "zod";
import { Provider } from "../core/provider.js";
import { ARWEAVE_GATEWAY_URL } from "../core/endpoints.js";
import {
  ExplorerError,
  NotFoundError,
  UnsupportedChainError,
  UnsupportedOperationError,
} from "../core/errors.js";
import { formatWei, toTimestamp } from "../core/types.js";
import type {
  Balance,
  ChainKey,
  ProviderCapabilities,
  ProviderConfig,
  Transaction,
  TxHistoryOptions,
} from "../core/types.js";

const TX_FIELDS = `id owner { address } recipient quantity { winston } fee { winston }
  block { height timestamp } bundledIn { id } data { size type } tags { name value }`;
const MAX_WINDOW = 1000;

function transactionSchema() {
  const amount = z.object({ winston: z.string().regex(/^\d+$/) });
  return z.object({
    id: z.string().min(1),
    owner: z.object({ address: z.string() }),
    recipient: z.string(),
    quantity: amount,
    fee: amount,
    block: z
      .object({
        height: z.number().int().nonnegative(),
        timestamp: z.number().int().nonnegative().max(8_640_000_000_000),
      })
      .nullable(),
    bundledIn: z.object({ id: z.string() }).nullable(),
    data: z.object({ size: z.string(), type: z.string().nullable() }),
    tags: z.array(z.object({ name: z.string(), value: z.string() })),
  });
}

type IndexedTransaction = z.infer<ReturnType<typeof transactionSchema>>;

function assertChain(chain: ChainKey): void {
  if (chain !== "arweave") throw new UnsupportedChainError(chain, Arweave.key);
}

function assertIdentifier(value: string): void {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new ExplorerError(
      "Expected an Arweave address or transaction ID with 43 characters",
      Arweave.key,
    );
  }
}

/* oxlint-disable-next-line typescript/prefer-readonly-parameter-types */
function mapTransaction(tx: IndexedTransaction): Transaction {
  return {
    hash: tx.id,
    from: tx.owner.address,
    to: tx.recipient,
    value: tx.quantity.winston,
    valueFormatted: formatWei(tx.quantity.winston, 12),
    ...(tx.bundledIn === null ? { fee: tx.fee.winston } : {}),
    blockNumber: tx.block?.height ?? 0,
    ...(tx.block === null ? {} : { timestamp: toTimestamp(tx.block.timestamp) }),
    status: tx.block === null ? "pending" : "success",
    isContractInteraction: false,
    tokenTransfers: [],
    raw: { ...tx },
  };
}

function validInteger(value: number, min: number, max: number): boolean {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

function historyWindow(options: Readonly<TxHistoryOptions>) {
  const limit = options.limit ?? 100;
  const page = options.page ?? 1;
  if (!validInteger(limit, 1, 100) || !validInteger(page, 1, Math.floor(MAX_WINDOW / limit))) {
    throw new ExplorerError(
      "Arweave history requires limit from 1 to 100 and page * limit <= 1000",
      Arweave.key,
    );
  }
  assertBlockBounds(options);
  return { limit, count: page * limit, offset: (page - 1) * limit };
}

function assertBlockBounds(options: Readonly<TxHistoryOptions>): void {
  for (const height of [options.startBlock, options.endBlock]) {
    if (height !== undefined && !validInteger(height, 0, 2_147_483_647)) {
      throw new ExplorerError(
        "Arweave block bounds must be nonnegative GraphQL Int values",
        Arweave.key,
      );
    }
  }
  if (
    options.startBlock !== undefined &&
    options.endBlock !== undefined &&
    options.startBlock > options.endBlock
  ) {
    throw new ExplorerError("Arweave startBlock must not exceed endBlock", Arweave.key);
  }
}

/** Arweave transaction metadata from a gateway's GraphQL index, without fullnode reads. */
export class Arweave extends Provider {
  static readonly key = "arweave";
  private readonly endpoint: string;

  constructor(config: Readonly<ProviderConfig> = {}) {
    super(config);
    const base = config.baseUrl ?? ARWEAVE_GATEWAY_URL;
    this.endpoint = `${base.replace(/\/$/, "")}/graphql`;
  }

  get capabilities(): ProviderCapabilities {
    return {
      balances: false,
      txHistory: true,
      txDetail: true,
      contractInfo: false,
      tokenBalances: false,
      tokenTransfers: false,
      gasData: false,
      blockInfo: false,
    };
  }

  async getBalance(_address: string, chain: ChainKey = "arweave"): Promise<Balance> {
    assertChain(chain);
    throw new UnsupportedOperationError("getBalance", this.name);
  }

  private async query<T>(
    query: string,
    variables: Readonly<Record<string, unknown>>,
    /* oxlint-disable-next-line typescript/prefer-readonly-parameter-types */
    schema: z.ZodType<T>,
  ): Promise<T> {
    const raw = await this.postJSON<unknown>(this.endpoint, { query, variables });
    const parsed = z
      .object({
        data: schema.nullish(),
        errors: z.array(z.object({ message: z.string() })).optional(),
      })
      .safeParse(raw);
    if (!parsed.success) throw new ExplorerError("Invalid Arweave GraphQL response", this.name);
    if (parsed.data.errors?.length) {
      throw new ExplorerError(
        `Arweave GraphQL: ${parsed.data.errors.map((error) => error.message).join("; ")}`,
        this.name,
      );
    }
    if (parsed.data.data === null || parsed.data.data === undefined)
      throw new ExplorerError("Missing Arweave GraphQL data", this.name);
    return parsed.data.data;
  }

  override async getTxDetail(hash: string, chain: ChainKey = "arweave"): Promise<Transaction> {
    assertChain(chain);
    assertIdentifier(hash);
    const { transaction } = await this.query(
      `query ($id: ID!) { transaction(id: $id) { ${TX_FIELDS} } }`,
      { id: hash },
      z.object({ transaction: transactionSchema().nullable() }),
    );
    if (transaction === null) throw new NotFoundError(`transaction ${hash}`, this.name);
    return mapTransaction(transaction);
  }

  /**
   * GraphQL combines owners and recipients with AND, so read each direction separately.
   * @param {string} address - Address to match.
   * @param {"owners" | "recipients"} direction - Indexed address field.
   * @param {number} count - Number of rows needed before merging.
   * @param {Readonly<TxHistoryOptions>} options - Order and block bounds.
   * @returns {Promise<IndexedTransaction[]>} Rows from one direction.
   */
  private async historyDirection(
    address: string,
    direction: "owners" | "recipients",
    count: number,
    options: Readonly<TxHistoryOptions>,
  ): Promise<IndexedTransaction[]> {
    const result: IndexedTransaction[] = [];
    const seen = new Set<string>();
    let after: string | undefined;
    while (result.length < count) {
      const { transactions } = await this.query(
        `query ($addresses: [String!]!, $first: Int!, $after: String, $sort: SortOrder!, $block: RangeFilter) {
          transactions(${direction}: $addresses, first: $first, after: $after, sort: $sort, block: $block) {
            pageInfo { hasNextPage } edges { cursor node { ${TX_FIELDS} } }
          }
        }`,
        {
          addresses: [address],
          first: Math.min(100, count - result.length),
          after,
          sort: options.sort === "asc" ? "HEIGHT_ASC" : "HEIGHT_DESC",
          block: { min: options.startBlock, max: options.endBlock },
        },
        z.object({
          transactions: z.object({
            pageInfo: z.object({ hasNextPage: z.boolean() }),
            edges: z
              .array(z.object({ cursor: z.string().min(1), node: transactionSchema() }))
              .max(100),
          }),
        }),
      );
      result.push(...transactions.edges.map((edge) => edge.node));
      if (!transactions.pageInfo.hasNextPage) break;
      const cursor = transactions.edges.at(-1)?.cursor;
      if (!cursor || seen.has(cursor))
        throw new ExplorerError("Arweave history cursor did not advance", this.name);
      seen.add(cursor);
      after = cursor;
    }
    return result.slice(0, count);
  }

  async getTxHistory(
    address: string,
    chain: ChainKey = "arweave",
    options: Readonly<TxHistoryOptions> = {},
  ): Promise<Transaction[]> {
    assertChain(chain);
    assertIdentifier(address);
    const { count, offset, limit } = historyWindow(options);
    const [sent, received] = await Promise.all([
      this.historyDirection(address, "owners", count, options),
      this.historyDirection(address, "recipients", count, options),
    ]);
    const unique = new Map([...sent, ...received].map((tx) => [tx.id, tx]));
    const order = options.sort === "asc" ? 1 : -1;
    return [...unique.values()]
      .sort(
        (a, b) =>
          order *
          ((a.block?.height ?? Number.MAX_SAFE_INTEGER) -
            (b.block?.height ?? Number.MAX_SAFE_INTEGER)),
      )
      .slice(offset, offset + limit)
      .map(mapTransaction);
  }
}
