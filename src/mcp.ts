import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { UnsupportedOperationError } from "./core/errors.js";
import { resolveAddresses, resolveInput } from "./core/input.js";
import type { Provider } from "./core/provider.js";
import { create, getDefaultURL, providers } from "./core/registry.js";
import { PROVIDER_DEFAULT_CHAIN, resolveProvider } from "./core/resolve.js";
import { normalizeChain } from "./core/types.js";
import type { ProviderCapabilities } from "./core/types.js";
import { version } from "./version.js";
import "./providers/index.js";

const providerInput = {
  chain: z.string().trim().min(1).optional().describe("Chain name or alias"),
  provider: z.string().trim().min(1).optional().describe("Explorer provider key"),
};
type ProviderOperation =
  | "getBalance"
  | "getTxHistory"
  | "getTxDetail"
  | "getContractInfo"
  | "getTokenBalances"
  | "getTokenTransfers"
  | "getGasData"
  | "getBlockInfo";
const OPERATION_CAPABILITIES = {
  getBalance: "balances",
  getTxHistory: "txHistory",
  getTxDetail: "txDetail",
  getContractInfo: "contractInfo",
  getTokenBalances: "tokenBalances",
  getTokenTransfers: "tokenTransfers",
  getGasData: "gasData",
  getBlockInfo: "blockInfo",
} as const satisfies Record<ProviderOperation, keyof ProviderCapabilities>;

function selectedProvider(providerName?: string, chainName?: string) {
  const requestedChain = chainName === undefined ? undefined : normalizeChain(chainName);
  const name = resolveProvider(providerName, requestedChain);
  const provider = create(name);
  const chain = requestedChain ?? normalizeChain(PROVIDER_DEFAULT_CHAIN[name]);
  return { chain, name, provider };
}

function result(value: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

function providerResult(provider: string, value: unknown): CallToolResult {
  return result({ provider, data: value });
}

async function addressForChain(address: string, chain: Parameters<typeof resolveInput>[1]) {
  return (await resolveInput(address, chain)).address;
}

function requireOperation<K extends ProviderOperation>(
  provider: Provider,
  operation: K,
): NonNullable<Provider[K]> {
  const method = provider[operation];
  if (!provider.capabilities[OPERATION_CAPABILITIES[operation]] || typeof method !== "function") {
    throw new UnsupportedOperationError(operation, provider.name);
  }
  return method.bind(provider) as NonNullable<Provider[K]>;
}

/** Create an MCP server exposing the normalized explorer operations. */
export function createMcpServer(): McpServer {
  const server = new McpServer({ name: "explorers", version });

  server.registerTool(
    "explorers_providers",
    {
      description: "List registered block explorer providers and their capabilities",
      annotations: { readOnlyHint: true },
    },
    () =>
      result(
        providers().map((name) => {
          try {
            const provider = create(name);
            return {
              name,
              defaultUrl: getDefaultURL(name),
              capabilities: provider.capabilities,
            };
          } catch {
            return {
              name,
              defaultUrl: getDefaultURL(name),
              requiresConfiguration: true,
            };
          }
        }),
      ),
  );

  server.registerTool(
    "explorers_balance",
    {
      description:
        "Get the native-token balance for one or more blockchain addresses or ENS names",
      inputSchema: {
        address: z
          .union([
            z.string().trim().min(1),
            z.array(z.string().trim().min(1)).min(1).max(20),
          ])
          .describe("Blockchain address or ENS name, or a list of them"),
        ...providerInput,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ address, chain, provider }) => {
      const selected = selectedProvider(provider, chain);
      const resolvedAddresses = await resolveAddresses(address, selected.chain);
      const getBalance = requireOperation(selected.provider, "getBalance");
      const balances = await Promise.all(
        resolvedAddresses.map((resolvedAddress) => getBalance(resolvedAddress, selected.chain)),
      );
      return providerResult(selected.name, typeof address === "string" ? balances[0] : balances);
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
      },
      annotations: { readOnlyHint: true },
    },
    async ({ address, chain, provider, ...options }) => {
      const selected = selectedProvider(provider, chain);
      const resolvedAddress = await addressForChain(address, selected.chain);
      const getTxHistory = requireOperation(selected.provider, "getTxHistory");
      return providerResult(
        selected.name,
        await getTxHistory(resolvedAddress, selected.chain, options),
      );
    },
  );

  server.registerTool(
    "explorers_tx_detail",
    {
      description:
        "Get one normalized transaction by hash, with OP_RETURN messages when the provider is mempool",
      inputSchema: { hash: z.string().min(1), ...providerInput },
      annotations: { readOnlyHint: true },
    },
    async ({ hash, chain, provider }) => {
      const selected = selectedProvider(provider, chain);
      const getTxDetail = requireOperation(selected.provider, "getTxDetail");
      return providerResult(selected.name, await getTxDetail(hash, selected.chain));
    },
  );

  server.registerTool(
    "explorers_contract",
    {
      description: "Get verification, compiler, creator, proxy, ABI, and source metadata",
      inputSchema: { address: z.string().min(1), ...providerInput },
      annotations: { readOnlyHint: true },
    },
    async ({ address, chain, provider }) => {
      const selected = selectedProvider(provider, chain);
      const getContractInfo = requireOperation(selected.provider, "getContractInfo");
      const resolvedAddress = await addressForChain(address, selected.chain);
      return providerResult(selected.name, await getContractInfo(resolvedAddress, selected.chain));
    },
  );

  server.registerTool(
    "explorers_tokens",
    {
      description: "List token holdings for a blockchain address",
      inputSchema: {
        address: z.string().min(1),
        ...providerInput,
        nonZeroOnly: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ address, chain, provider, nonZeroOnly }) => {
      const selected = selectedProvider(provider, chain);
      const resolvedAddress = await addressForChain(address, selected.chain);
      const getTokenBalances = requireOperation(selected.provider, "getTokenBalances");
      return providerResult(
        selected.name,
        await getTokenBalances(resolvedAddress, selected.chain, { nonZeroOnly }),
      );
    },
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
    async ({ address, chain, provider, ...options }) => {
      const selected = selectedProvider(provider, chain);
      const resolvedAddress = await addressForChain(address, selected.chain);
      const getTokenTransfers = requireOperation(selected.provider, "getTokenTransfers");
      return providerResult(
        selected.name,
        await getTokenTransfers(resolvedAddress, selected.chain, options),
      );
    },
  );

  server.registerTool(
    "explorers_gas",
    {
      description: "Get current gas or fee-market suggestions",
      inputSchema: providerInput,
      annotations: { readOnlyHint: true },
    },
    async ({ chain, provider }) => {
      const selected = selectedProvider(provider, chain);
      const getGasData = requireOperation(selected.provider, "getGasData");
      return providerResult(selected.name, await getGasData(selected.chain));
    },
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
    async ({ blockNumber, chain, provider }) => {
      const selected = selectedProvider(provider, chain);
      const getBlockInfo = requireOperation(selected.provider, "getBlockInfo");
      return providerResult(selected.name, await getBlockInfo(blockNumber, selected.chain));
    },
  );

  return server;
}
