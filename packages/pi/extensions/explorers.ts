/**
 * Pi extension: Explorers — unified block explorer tools
 */
import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type * as ExplorersModule from "../../../src/index.js";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

/** Lazy-load the library (registers all providers on import). */
async function loadLib() {
  const packageName = "@oritwoen/explorers";
  try {
    return (await import(packageName)) as unknown as typeof ExplorersModule;
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : undefined;
    if (code !== "ERR_MODULE_NOT_FOUND" && code !== "MODULE_NOT_FOUND") {
      throw error;
    }
    // @ts-expect-error — Pi runs TypeScript extension sources directly in development
    return import("../../../src/index.ts") as Promise<typeof ExplorersModule>;
  }
}

type ExplorersToolResult = AgentToolResult<undefined>;

function textResult(text: string): ExplorersToolResult {
  return {
    content: [{ type: "text", text }],
    details: undefined,
  };
}

async function getProvider(preferred?: string) {
  const lib = await loadLib();
  const name = lib.resolveProvider(preferred);
  return { lib, name, provider: lib.create(name) };
}

function resolveToolChain(lib: typeof ExplorersModule, providerName: string, requested?: string) {
  return lib.normalizeChain(requested ?? lib.PROVIDER_DEFAULT_CHAIN[providerName]);
}

export default function explorersExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "explorers_balance",
    label: "Explorers Balance",
    description: "Get native token balance for a blockchain address",
    promptSnippet: "Use to check ETH, BTC, or other native token balances across chains.",
    promptGuidelines: [
      "Provide a blockchain address and optionally a chain (eth, base, bitcoin, ...)",
      "Without an explicit provider or chain, defaults to Ethereum mainnet",
      "Returns raw base-unit and human-readable balances",
    ],
    parameters: Type.Object({
      address: Type.String({ description: "Blockchain address" }),
      chain: Type.Optional(
        Type.String({
          description: "Chain (eth, base, arbitrum, bitcoin, solana, ...)",
        }),
      ),
      provider: Type.Optional(
        Type.String({ description: "Provider (etherscan, blockscout, blockchair)" }),
      ),
    }),
    renderCall(args, _theme) {
      return new Text(`🔍 Balance: ${args.address} (${args.chain ?? "provider default"})`, 0, 0);
    },
    async execute(_toolCallId, params): Promise<ExplorersToolResult> {
      const { lib, name, provider } = await getProvider(params.provider);
      const chain = resolveToolChain(lib, name, params.chain);
      const balance = await provider.getBalance(params.address, chain);
      return textResult(
        `[${name}] ${balance.chain} balance for ${balance.address}: ${balance.balanceFormatted} ${balance.symbol} (${balance.balance} base units)`,
      );
    },
  });

  pi.registerTool({
    name: "explorers_tx_history",
    label: "Explorers Tx History",
    description: "Get transaction history for a blockchain address",
    promptSnippet: "Use to list recent transactions for any address.",
    promptGuidelines: [
      "Provide a blockchain address and optionally a chain and limit",
      "Returns normalized tx list with from/to/value/status",
      "Default limit is 10",
    ],
    parameters: Type.Object({
      address: Type.String({ description: "Blockchain address" }),
      chain: Type.Optional(Type.String({ description: "Chain" })),
      limit: Type.Optional(Type.Number({ description: "Max results", default: 10 })),
      provider: Type.Optional(Type.String({ description: "Provider" })),
    }),
    renderCall(args, _theme) {
      return new Text(`📜 Tx history: ${args.address} (limit: ${args.limit ?? 10})`, 0, 0);
    },
    async execute(_toolCallId, params): Promise<ExplorersToolResult> {
      const { lib, name, provider } = await getProvider(params.provider);
      const chain = resolveToolChain(lib, name, params.chain);
      const txs = await provider.getTxHistory(params.address, chain, { limit: params.limit });

      const lines = txs.map(
        (tx) =>
          `${tx.hash.slice(0, 14)}… ${tx.from.slice(0, 10)}…→${(tx.to ?? "new").slice(0, 10)}… ${tx.valueFormatted} [${tx.status}]`,
      );

      return textResult(`[${name}] ${txs.length} transactions on ${chain}:\n${lines.join("\n")}`);
    },
  });

  pi.registerTool({
    name: "explorers_tx_detail",
    label: "Explorers Tx Detail",
    description: "Get detailed info about a specific transaction",
    promptSnippet: "Use to inspect a single transaction by hash.",
    promptGuidelines: [
      "Provide a chain-native transaction hash and optionally a chain",
      "Returns full tx details including fees, status, method, and token transfers",
    ],
    parameters: Type.Object({
      hash: Type.String({ description: "Transaction hash" }),
      chain: Type.Optional(Type.String({ description: "Chain" })),
      provider: Type.Optional(Type.String({ description: "Provider" })),
    }),
    renderCall(args, _theme) {
      return new Text(`🔬 Tx detail: ${args.hash.slice(0, 18)}…`, 0, 0);
    },
    async execute(_toolCallId, params): Promise<ExplorersToolResult> {
      const { lib, name, provider } = await getProvider(params.provider);
      const chain = resolveToolChain(lib, name, params.chain);
      if (!provider.capabilities.txDetail || !provider.getTxDetail) {
        return textResult(`Provider "${name}" does not support transaction details`);
      }
      const tx = await provider.getTxDetail(params.hash, chain);

      const parts = [
        `[${name}] Tx ${tx.hash}`,
        `Block: ${tx.blockNumber} | Status: ${tx.status}`,
        tx.fee ? `Fee: ${tx.fee} base units` : null,
        `From: ${tx.from}`,
        `To: ${tx.to ?? "contract creation"}`,
        `Value: ${tx.valueFormatted}`,
        tx.functionName ? `Method: ${tx.functionName}` : null,
        tx.tokenTransfers.length > 0 ? `Token transfers: ${tx.tokenTransfers.length}` : null,
      ].filter(Boolean);

      return textResult(parts.join("\n"));
    },
  });

  pi.registerTool({
    name: "explorers_contract",
    label: "Explorers Contract",
    description: "Get smart contract info — verification, ABI, source, proxy status",
    promptSnippet: "Use to check if a contract is verified, get its ABI, or detect proxies.",
    promptGuidelines: [
      "Provide a contract address and optionally a chain",
      "Returns verification status, name, compiler, ABI (if verified), proxy info",
    ],
    parameters: Type.Object({
      address: Type.String({ description: "Contract address" }),
      chain: Type.Optional(Type.String({ description: "Chain" })),
      provider: Type.Optional(Type.String({ description: "Provider" })),
    }),
    renderCall(args, _theme) {
      return new Text(`📋 Contract: ${args.address}`, 0, 0);
    },
    async execute(_toolCallId, params): Promise<ExplorersToolResult> {
      const { lib, name, provider } = await getProvider(params.provider);
      const chain = resolveToolChain(lib, name, params.chain);
      if (!provider.capabilities.contractInfo || !provider.getContractInfo) {
        return textResult(`Provider "${name}" does not support contract info`);
      }
      const info = await provider.getContractInfo(params.address, chain);

      const parts = [
        `[${name}] Contract ${info.address}`,
        `Verified: ${info.isVerified}`,
        info.name ? `Name: ${info.name}` : null,
        info.compilerVersion ? `Compiler: ${info.compilerVersion}` : null,
        info.isProxy ? `Proxy → ${info.implementationAddress}` : null,
        info.isToken ? "Is token: yes" : null,
        info.creator ? `Creator: ${info.creator}` : null,
      ].filter(Boolean);

      return textResult(parts.join("\n"));
    },
  });

  pi.registerTool({
    name: "explorers_gas",
    label: "Explorers Gas",
    description: "Get current gas prices for a chain",
    promptSnippet: "Use to check gas prices before sending a transaction.",
    promptGuidelines: [
      "Provide a chain or use the selected provider's default",
      "Returns safe/average/fast prices with the provider-native unit",
    ],
    parameters: Type.Object({
      chain: Type.Optional(Type.String({ description: "Chain" })),
      provider: Type.Optional(Type.String({ description: "Provider" })),
    }),
    renderCall(args, _theme) {
      return new Text(`⛽ Gas prices: ${args.chain ?? "provider default"}`, 0, 0);
    },
    async execute(_toolCallId, params): Promise<ExplorersToolResult> {
      const { lib, name, provider } = await getProvider(params.provider);
      const chain = resolveToolChain(lib, name, params.chain);

      const caps = provider.capabilities;
      if (!caps.gasData || !provider.getGasData) {
        return textResult(`Provider "${name}" does not support gas data`);
      }

      const gas = await provider.getGasData(chain);
      const parts = [
        `[${name}] Gas on ${gas.chain}:`,
        gas.safeGasPrice ? `  Safe: ${gas.safeGasPrice} ${gas.unit}` : null,
        gas.proposedGasPrice ? `  Average: ${gas.proposedGasPrice} ${gas.unit}` : null,
        gas.priorityFee ? `  Priority: ${gas.priorityFee} ${gas.unit}` : null,
        gas.fastGasPrice ? `  Fast: ${gas.fastGasPrice} ${gas.unit}` : null,
        gas.baseFee ? `  Base fee: ${gas.baseFee} ${gas.unit}` : null,
      ].filter(Boolean);

      return textResult(parts.join("\n"));
    },
  });

  pi.registerTool({
    name: "explorers_providers",
    label: "Explorers Providers",
    description: "List registered block explorer providers and their capabilities",
    promptSnippet: "Use to check which block explorer providers are available.",
    promptGuidelines: ["Returns provider names and their capability flags."],
    parameters: Type.Object({}),
    renderCall(_args, _theme) {
      return new Text("🔍 List Explorers providers", 0, 0);
    },
    async execute(): Promise<ExplorersToolResult> {
      const lib = await loadLib();
      const names = lib.providers();

      const lines = names.map((name) => {
        const provider = lib.create(name);
        const caps = provider.capabilities;
        const active = Object.entries(caps)
          .filter(([, v]) => v)
          .map(([k]) => k);
        return `  ${name}: ${active.join(", ")}`;
      });

      return textResult(`Registered providers (${names.length}):\n${lines.join("\n")}`);
    },
  });
}
