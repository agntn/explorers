import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { UnsupportedOperationError } from "./core/errors.ts";
import { resolveAddresses, resolveInput } from "./core/input.ts";
import type { Provider } from "./core/provider.ts";
import { listProviders } from "./core/registry.ts";
import { withProvider } from "./core/resolve.ts";
import type { ProviderContext } from "./core/resolve.ts";
import { clampMaxResults, normalizeChain } from "./core/types.ts";
import type { ContractInfo, ProviderCapabilities, Transaction } from "./core/types.ts";
import { version } from "./version.ts";

const providerInput = {
  chain: z.string().trim().min(1).optional().describe("Chain name or alias"),
  provider: z.string().trim().min(1).optional().describe("Explorer provider key"),
};
const rawInput = {
  raw: z
    .boolean()
    .optional()
    .describe(
      "Include the provider's own transaction record as raw, for fields the normalized shape leaves out, such as every input and output of a Bitcoin transaction. Defaults to false.",
    ),
};
/** Holdings one tokens call lists unless asked for more; a busy wallet holds thousands. */
const TOKEN_HOLDINGS_LIMIT = 50;
const contractPayloadInput = {
  abi: z
    .boolean()
    .optional()
    .describe("Include the ABI of a verified contract as a JSON string. Defaults to false."),
  sourceCode: z
    .boolean()
    .optional()
    .describe("Include the source code of a verified contract. Defaults to false."),
};
type ProviderOperation =
  | "getBalance"
  | "getTxHistory"
  | "getTxDetail"
  | "getUtxos"
  | "getContractInfo"
  | "getTokenBalances"
  | "getTokenTransfers"
  | "getGasData"
  | "getBlockInfo";
const OPERATION_CAPABILITIES = {
  getBalance: "balances",
  getTxHistory: "txHistory",
  getTxDetail: "txDetail",
  getUtxos: "utxos",
  getContractInfo: "contractInfo",
  getTokenBalances: "tokenBalances",
  getTokenTransfers: "tokenTransfers",
  getGasData: "gasData",
  getBlockInfo: "blockInfo",
} as const satisfies Record<ProviderOperation, keyof ProviderCapabilities>;

function withSelectedProvider<T>(
  providerName: string | undefined,
  chainName: string | undefined,
  operation: ProviderOperation,
  signal: AbortSignal,
  /* oxlint-disable-next-line typescript/prefer-readonly-parameter-types */
  run: (selected: ProviderContext) => Promise<T>,
  input?: string,
): Promise<T> {
  const requestedChain = chainName === undefined ? undefined : normalizeChain(chainName);
  return withProvider(
    providerName,
    requestedChain,
    run,
    OPERATION_CAPABILITIES[operation],
    input,
    signal,
  );
}

function result(value: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

function providerResult(provider: string, value: unknown): CallToolResult {
  return result({ provider, data: value });
}

/* The provider's record dwarfs the normalized fields, so it travels only when asked for. */
/* oxlint-disable-next-line typescript/prefer-readonly-parameter-types */
function trimTransaction(transaction: Transaction, keepRaw = false): Transaction {
  if (keepRaw) return transaction;
  const { raw: _raw, ...trimmed } = transaction;
  return trimmed;
}

/* ABI and source run to tens of kilobytes; a caller after verification or proxy status skips them. */
function trimContract(
  info: Readonly<ContractInfo>,
  requested: Readonly<{ abi?: boolean; sourceCode?: boolean }>,
): ContractInfo {
  const { abi, sourceCode, ...trimmed } = info;
  const contract: ContractInfo = trimmed;
  if (requested.abi) contract.abi = abi;
  if (requested.sourceCode) contract.sourceCode = sourceCode;
  return contract;
}

async function addressForChain(address: string, chain: Parameters<typeof resolveInput>[1]) {
  return (await resolveInput(address, chain)).address;
}

function requireOperation<K extends ProviderOperation>(
  /* oxlint-disable-next-line typescript/prefer-readonly-parameter-types */
  provider: Provider,
  operation: K,
): NonNullable<Provider[K]> {
  const method = provider[operation];
  if (!provider.capabilities[OPERATION_CAPABILITIES[operation]] || typeof method !== "function") {
    throw new UnsupportedOperationError(operation, provider.name);
  }
  return method.bind(provider) as NonNullable<Provider[K]>;
}

/**
 * Create an MCP server exposing the normalized explorer operations.
 *
 * @returns {McpServer} The resulting value.
 */
export function createMcpServer(): McpServer {
  const server = new McpServer({ name: "explorers", version });

  server.registerTool(
    "explorers_providers",
    {
      description:
        "List registered block explorer providers with the chains they serve, their capabilities, and their public endpoints",
      annotations: { readOnlyHint: true },
    },
    () => result(listProviders()),
  );

  server.registerTool(
    "explorers_balance",
    {
      description: "Get the native-token balance for one or more blockchain addresses or ENS names",
      inputSchema: {
        address: z
          .union([z.string().trim().min(1), z.array(z.string().trim().min(1)).min(1).max(20)])
          .describe("Blockchain address or ENS name, or a list of them"),
        ...providerInput,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ address, chain, provider }, { signal }) => {
      const requestedChain = chain === undefined ? undefined : normalizeChain(chain);
      return withProvider(
        provider,
        requestedChain,
        async (selected) => {
          const resolvedAddresses = await resolveAddresses(address, selected.chain);
          const getBalance = requireOperation(selected.provider, "getBalance");
          const balances = await Promise.all(
            resolvedAddresses.map((resolvedAddress) => getBalance(resolvedAddress, selected.chain)),
          );
          return providerResult(
            selected.name,
            typeof address === "string" ? balances[0] : balances,
          );
        },
        "balances",
        address,
        signal,
      );
    },
  );

  server.registerTool(
    "explorers_tx_history",
    {
      description: "List normalized transactions involving a blockchain address",
      inputSchema: {
        address: z.string().min(1),
        ...providerInput,
        startBlock: z.number().int().nonnegative().optional(),
        endBlock: z.number().int().nonnegative().optional(),
        sort: z.enum(["asc", "desc"]).optional(),
        limit: z.number().int().positive().max(100).optional(),
        page: z.number().int().positive().optional(),
        ...rawInput,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ address, chain, provider, raw, ...options }, { signal }) =>
      withSelectedProvider(
        provider,
        chain,
        "getTxHistory",
        signal,
        async (selected) => {
          const resolvedAddress = await addressForChain(address, selected.chain);
          const getTxHistory = requireOperation(selected.provider, "getTxHistory");
          const transactions = await getTxHistory(resolvedAddress, selected.chain, options);
          return providerResult(
            selected.name,
            transactions.map((transaction) => trimTransaction(transaction, raw)),
          );
        },
        address,
      ),
  );

  server.registerTool(
    "explorers_tx_detail",
    {
      description:
        "Get one normalized transaction by hash, with OP_RETURN messages when the provider is mempool",
      inputSchema: { hash: z.string().min(1), ...providerInput, ...rawInput },
      annotations: { readOnlyHint: true },
    },
    async ({ hash, chain, provider, raw }, { signal }) =>
      withSelectedProvider(provider, chain, "getTxDetail", signal, async (selected) => {
        const getTxDetail = requireOperation(selected.provider, "getTxDetail");
        return providerResult(
          selected.name,
          trimTransaction(await getTxDetail(hash, selected.chain), raw),
        );
      }),
  );

  server.registerTool(
    "explorers_utxos",
    {
      description:
        "List the unspent outputs a Bitcoin-like address still controls, each as txid and vout with its value in base units and confirmation state",
      inputSchema: { address: z.string().min(1), ...providerInput },
      annotations: { readOnlyHint: true },
    },
    async ({ address, chain, provider }, { signal }) =>
      withSelectedProvider(
        provider,
        chain,
        "getUtxos",
        signal,
        async (selected) => {
          const resolvedAddress = await addressForChain(address, selected.chain);
          const getUtxos = requireOperation(selected.provider, "getUtxos");
          return providerResult(selected.name, await getUtxos(resolvedAddress, selected.chain));
        },
        address,
      ),
  );

  server.registerTool(
    "explorers_contract",
    {
      description:
        "Get verification, compiler, creator, proxy and token metadata for a contract, plus its ABI and source on request",
      inputSchema: { address: z.string().min(1), ...providerInput, ...contractPayloadInput },
      annotations: { readOnlyHint: true },
    },
    async ({ address, chain, provider, ...requested }, { signal }) =>
      withSelectedProvider(
        provider,
        chain,
        "getContractInfo",
        signal,
        async (selected) => {
          const getContractInfo = requireOperation(selected.provider, "getContractInfo");
          const resolvedAddress = await addressForChain(address, selected.chain);
          return providerResult(
            selected.name,
            trimContract(await getContractInfo(resolvedAddress, selected.chain), requested),
          );
        },
        address,
      ),
  );

  server.registerTool(
    "explorers_tokens",
    {
      description:
        "List token holdings for a blockchain address: the first 50 in the explorer's order unless limit says otherwise; total counts every holding the list was cut from. Zero balances are dropped unless nonZeroOnly is false.",
      inputSchema: {
        address: z.string().min(1),
        ...providerInput,
        nonZeroOnly: z
          .boolean()
          .optional()
          .default(true)
          .describe("Drop holdings whose balance is zero. Defaults to true."),
        limit: z
          .number()
          .int()
          .positive()
          .max(100)
          .optional()
          .default(TOKEN_HOLDINGS_LIMIT)
          .describe(
            "Holdings to list, at most 100; total still counts every holding. Defaults to 50.",
          ),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ address, chain, provider, nonZeroOnly, limit }, { signal }) =>
      withSelectedProvider(
        provider,
        chain,
        "getTokenBalances",
        signal,
        async (selected) => {
          const resolvedAddress = await addressForChain(address, selected.chain);
          const getTokenBalances = requireOperation(selected.provider, "getTokenBalances");
          const holdings = await getTokenBalances(resolvedAddress, selected.chain, {
            nonZeroOnly: nonZeroOnly ?? true,
          });
          return result({
            provider: selected.name,
            total: holdings.length,
            data: holdings.slice(0, clampMaxResults(limit ?? TOKEN_HOLDINGS_LIMIT)),
          });
        },
        address,
      ),
  );

  server.registerTool(
    "explorers_token_transfers",
    {
      description:
        "List fungible-token transfers involving a blockchain address, including transfers sent to it by third parties that never show up in its native transaction history",
      inputSchema: {
        address: z.string().min(1),
        ...providerInput,
        token: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Only transfers of this token contract"),
        startBlock: z.number().int().nonnegative().optional(),
        endBlock: z.number().int().nonnegative().optional(),
        sort: z.enum(["asc", "desc"]).optional(),
        limit: z.number().int().positive().max(100).optional(),
        page: z.number().int().positive().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ address, chain, provider, ...options }, { signal }) =>
      withSelectedProvider(
        provider,
        chain,
        "getTokenTransfers",
        signal,
        async (selected) => {
          const resolvedAddress = await addressForChain(address, selected.chain);
          const getTokenTransfers = requireOperation(selected.provider, "getTokenTransfers");
          return providerResult(
            selected.name,
            await getTokenTransfers(resolvedAddress, selected.chain, options),
          );
        },
        address,
      ),
  );

  server.registerTool(
    "explorers_gas",
    {
      description: "Get current gas or fee-market suggestions",
      inputSchema: providerInput,
      annotations: { readOnlyHint: true },
    },
    async ({ chain, provider }, { signal }) =>
      withSelectedProvider(provider, chain, "getGasData", signal, async (selected) => {
        const getGasData = requireOperation(selected.provider, "getGasData");
        return providerResult(selected.name, await getGasData(selected.chain));
      }),
  );

  server.registerTool(
    "explorers_block",
    {
      description: "Get normalized block information by block number",
      inputSchema: {
        blockNumber: z.number().int().nonnegative(),
        ...providerInput,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ blockNumber, chain, provider }, { signal }) =>
      withSelectedProvider(provider, chain, "getBlockInfo", signal, async (selected) => {
        const getBlockInfo = requireOperation(selected.provider, "getBlockInfo");
        return providerResult(selected.name, await getBlockInfo(blockNumber, selected.chain));
      }),
  );

  return server;
}
