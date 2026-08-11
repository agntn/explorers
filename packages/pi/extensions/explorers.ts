/** Pi extension: Explorers — unified block explorer tools */
import { fileURLToPath } from "node:url";
import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type * as ExplorersModule from "../../../src/index.js";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

const sourceModulePath = fileURLToPath(new URL("../../../src/index.ts", import.meta.url));
let explorersModulePromise: Promise<typeof ExplorersModule> | undefined;

function isMissingSourceModule(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  const code = String(error.code);
  if (code !== "ERR_MODULE_NOT_FOUND" && code !== "MODULE_NOT_FOUND") return false;

  const message = error instanceof Error ? error.message : "";
  return (
    message.includes(`Cannot find module '${sourceModulePath}'`) ||
    message.includes(`Cannot find module "${sourceModulePath}"`)
  );
}

/** Load current source in development and fall back to the installed package in distributions. */
function loadLib(): Promise<typeof ExplorersModule> {
  if (explorersModulePromise) return explorersModulePromise;

  // @ts-expect-error — Pi runs TypeScript extension sources directly in development
  const loaded = import("../../../src/index.ts").catch((error: unknown) => {
    if (!isMissingSourceModule(error)) throw error;
    return import("@oritwoen/explorers") as unknown as Promise<typeof ExplorersModule>;
  });
  explorersModulePromise = loaded;
  return loaded;
}

interface TxDetailToolDetails {
  provider: string;
  transaction: ExplorersModule.Transaction;
}

type TxDetailToolResult = AgentToolResult<TxDetailToolDetails>;

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
    description: "Get a native-token balance for a blockchain address",
    promptSnippet: "Use to check ETH, BTC, or other native-token balances across chains.",
    promptGuidelines: [
      "Use explorers_balance with a blockchain address and optionally a chain.",
      "explorers_balance defaults to Ethereum mainnet when neither provider nor chain is explicit.",
      "explorers_balance returns raw base-unit and human-readable balances.",
    ],
    parameters: Type.Object({
      address: Type.String({ description: "Blockchain address" }),
      chain: Type.Optional(
        Type.String({
          description: "Chain (eth, base, arbitrum, bitcoin, solana, ...)",
        }),
      ),
      provider: Type.Optional(
        Type.String({
          description:
            "Registered provider key, for example blockscout, etherscan, mempool, or solscan; use explorers_providers to list all providers",
        }),
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
      "Use explorers_tx_history with a blockchain address and optionally a chain and limit.",
      "explorers_tx_history returns normalized transactions with from, to, value, and status.",
      "explorers_tx_history defaults to 10 results.",
    ],
    parameters: Type.Object({
      address: Type.String({ description: "Blockchain address" }),
      chain: Type.Optional(Type.String({ description: "Chain" })),
      limit: Type.Optional(
        Type.Integer({
          description: "Maximum number of results",
          minimum: 1,
          maximum: 100,
          default: 10,
        }),
      ),
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
      "Use explorers_tx_detail with a chain-native transaction hash and optionally a chain.",
      "explorers_tx_detail returns fees, status, method, and token-transfer count.",
    ],
    parameters: Type.Object({
      hash: Type.String({ description: "Transaction hash" }),
      chain: Type.Optional(Type.String({ description: "Chain" })),
      provider: Type.Optional(Type.String({ description: "Provider" })),
    }),
    renderCall(args, _theme) {
      return new Text(`🔬 Tx detail: ${args.hash.slice(0, 18)}…`, 0, 0);
    },
    async execute(_toolCallId, params): Promise<TxDetailToolResult> {
      const { lib, name, provider } = await getProvider(params.provider);
      const chain = resolveToolChain(lib, name, params.chain);
      if (!provider.capabilities.txDetail || !provider.getTxDetail) {
        throw new lib.UnsupportedOperationError("getTxDetail", name);
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

      return {
        content: [{ type: "text", text: parts.join("\n") }],
        details: { provider: name, transaction: tx },
      };
    },
    renderResult(result, { expanded, isPartial }, theme) {
      if (isPartial) return new Text(theme.fg("warning", "Loading transaction…"), 0, 0);

      const details = result.details;
      if (!details) {
        const content = result.content.find((part) => part.type === "text");
        return new Text(
          theme.fg("error", content?.text ?? "Transaction details unavailable"),
          0,
          0,
        );
      }

      const tx = details.transaction;
      const statusColor =
        tx.status === "success" ? "success" : tx.status === "failed" ? "error" : "warning";
      const lines = [
        `${theme.fg("muted", `[${details.provider}]`)} ${theme.fg("accent", tx.hash)}`,
        `${theme.fg("muted", "Block")} ${tx.blockNumber}  ${theme.fg("muted", "Status")} ${theme.fg(statusColor, tx.status)}`,
        `${theme.fg("muted", "Value")} ${tx.valueFormatted}`,
      ];

      if (expanded) {
        if (tx.fee) lines.push(`${theme.fg("muted", "Fee")} ${tx.fee} base units`);
        lines.push(`${theme.fg("muted", "From")} ${tx.from}`);
        lines.push(`${theme.fg("muted", "To")} ${tx.to ?? "contract creation"}`);
        if (tx.functionName) lines.push(`${theme.fg("muted", "Method")} ${tx.functionName}`);
        if (tx.tokenTransfers.length > 0) {
          lines.push(
            `${theme.fg("muted", "Token transfers")} ${tx.tokenTransfers.length.toString()}`,
          );
        }
      }

      return new Text(lines.join("\n"), 0, 0);
    },
  });

  pi.registerTool({
    name: "explorers_contract",
    label: "Explorers Contract",
    description: "Get smart-contract metadata, verification, and proxy status",
    promptSnippet: "Use to check whether a contract is verified or acts as a proxy.",
    promptGuidelines: [
      "Use explorers_contract with a contract address and optionally a chain.",
      "explorers_contract returns verification, compiler, token, creator, and proxy metadata.",
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
        throw new lib.UnsupportedOperationError("getContractInfo", name);
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
      "Use explorers_gas with a chain or the selected provider's default.",
      "explorers_gas returns safe, average, fast, priority, and base prices when available.",
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
        throw new lib.UnsupportedOperationError("getGasData", name);
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
    description: "List registered block explorer providers",
    promptSnippet: "Use to check which block explorer providers are available.",
    promptGuidelines: [
      "Use explorers_providers to list provider keys accepted by the other explorer tools.",
    ],
    parameters: Type.Object({}),
    renderCall(_args, _theme) {
      return new Text("🔍 List Explorers providers", 0, 0);
    },
    async execute(): Promise<ExplorersToolResult> {
      const lib = await loadLib();
      const names = lib.providers();
      return textResult(`Registered providers (${names.length}):\n  ${names.join("\n  ")}`);
    },
  });
}
