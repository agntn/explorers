/** OMP extension: Explorers — unified block explorer tools. */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import type * as ExplorersModule from "../../../src/index.js";

const sourceModulePath = fileURLToPath(new URL("../../../src/index.ts", import.meta.url));
let explorersModulePromise: Promise<typeof ExplorersModule> | undefined;

/** Load current source in development and fall back to the installed package in distributions. */
function loadLib(): Promise<typeof ExplorersModule> {
  if (explorersModulePromise) return explorersModulePromise;

  const loaded: Promise<typeof ExplorersModule> = existsSync(sourceModulePath)
    ? // @ts-expect-error — OMP runs TypeScript extension sources directly in development
      import("../../../src/index.ts")
    : (import("@agntn/explorers") as unknown as Promise<typeof ExplorersModule>);
  explorersModulePromise = loaded;
  return loaded;
}

// oxlint-disable-next-line no-control-regex -- Terminal control bytes are precisely what this boundary removes.
const UNSAFE_TERMINAL_CONTROLS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/gu;

function sanitizeTerminalText(text: string): string {
  return text.replace(UNSAFE_TERMINAL_CONTROLS, "");
}

interface TxDetailToolDetails {
  provider: string;
  transaction: ExplorersModule.Transaction;
}

function textResult(text: string) {
  return {
    content: [{ type: "text" as const, text: sanitizeTerminalText(text) }],
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

/** Register Explorers tools with the OMP extension host. */
export default function explorersOmpExtension(pi: ExtensionAPI) {
  const { Text } = pi.pi;
  const { Type } = pi.typebox;
  pi.setLabel("Explorers");

  const balanceParameters = Type.Object({
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
  });

  pi.registerTool({
    name: "explorers_balance",
    label: "Explorers Balance",
    description:
      "Get a native-token balance for a blockchain address. Provider selection follows configured API keys and otherwise falls back to Blockscout on Ethereum; the result includes base-unit and human-readable balances.",
    parameters: balanceParameters,
    approval: "read",
    renderCall(args, _options, _theme) {
      return new Text(
        sanitizeTerminalText(`Balance: ${args.address} (${args.chain ?? "provider default"})`),
        0,
        0,
      );
    },
    async execute(_toolCallId, params) {
      const { lib, name, provider } = await getProvider(params.provider);
      const chain = resolveToolChain(lib, name, params.chain);
      const balance = await provider.getBalance(params.address, chain);
      return textResult(
        `[${name}] ${balance.chain} balance for ${balance.address}: ${balance.balanceFormatted} ${balance.symbol} (${balance.balance} base units)`,
      );
    },
  });

  const txHistoryParameters = Type.Object({
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
  });

  pi.registerTool({
    name: "explorers_tx_history",
    label: "Explorers Tx History",
    description:
      "Get normalized transaction history for a blockchain address, including from, to, value, and status. Returns 10 transactions by default and at most 100.",
    parameters: txHistoryParameters,
    approval: "read",
    renderCall(args, _options, _theme) {
      return new Text(
        sanitizeTerminalText(`Tx history: ${args.address} (limit: ${args.limit ?? 10})`),
        0,
        0,
      );
    },
    async execute(_toolCallId, params) {
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

  const txDetailParameters = Type.Object({
    hash: Type.String({ description: "Chain-native transaction hash" }),
    chain: Type.Optional(Type.String({ description: "Chain" })),
    provider: Type.Optional(Type.String({ description: "Provider" })),
  });

  pi.registerTool<typeof txDetailParameters, TxDetailToolDetails>({
    name: "explorers_tx_detail",
    label: "Explorers Tx Detail",
    description:
      "Inspect one transaction by hash. Returns normalized status, block, fee, value, method, and token-transfer count when the selected explorer supports transaction details.",
    parameters: txDetailParameters,
    approval: "read",
    renderCall(args, _options, _theme) {
      return new Text(sanitizeTerminalText(`Tx detail: ${args.hash.slice(0, 18)}…`), 0, 0);
    },
    async execute(_toolCallId, params) {
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
        content: [{ type: "text", text: sanitizeTerminalText(parts.join("\n")) }],
        details: { provider: name, transaction: tx },
      };
    },
    renderResult(result, { expanded, isPartial }, theme) {
      if (isPartial) return new Text(theme.fg("warning", "Loading transaction…"), 0, 0);

      const details = result.details;
      if (!details) {
        const content = result.content.find((part) => part.type === "text");
        return new Text(
          theme.fg(
            "error",
            sanitizeTerminalText(content?.text ?? "Transaction details unavailable"),
          ),
          0,
          0,
        );
      }

      const tx = details.transaction;
      const statusColor =
        tx.status === "success" ? "success" : tx.status === "failed" ? "error" : "warning";
      const lines = [
        `${theme.fg("muted", sanitizeTerminalText(`[${details.provider}]`))} ${theme.fg("accent", sanitizeTerminalText(tx.hash))}`,
        `${theme.fg("muted", "Block")} ${sanitizeTerminalText(String(tx.blockNumber))}  ${theme.fg("muted", "Status")} ${theme.fg(statusColor, sanitizeTerminalText(tx.status))}`,
        `${theme.fg("muted", "Value")} ${sanitizeTerminalText(tx.valueFormatted)}`,
      ];

      if (expanded) {
        if (tx.fee) {
          lines.push(`${theme.fg("muted", "Fee")} ${sanitizeTerminalText(tx.fee)} base units`);
        }
        lines.push(`${theme.fg("muted", "From")} ${sanitizeTerminalText(tx.from)}`);
        lines.push(
          `${theme.fg("muted", "To")} ${sanitizeTerminalText(tx.to ?? "contract creation")}`,
        );
        if (tx.functionName) {
          lines.push(`${theme.fg("muted", "Method")} ${sanitizeTerminalText(tx.functionName)}`);
        }
        if (tx.tokenTransfers.length > 0) {
          lines.push(
            `${theme.fg("muted", "Token transfers")} ${tx.tokenTransfers.length.toString()}`,
          );
        }
      }

      return new Text(lines.join("\n"), 0, 0);
    },
  });

  const contractParameters = Type.Object({
    address: Type.String({ description: "Contract address" }),
    chain: Type.Optional(Type.String({ description: "Chain" })),
    provider: Type.Optional(Type.String({ description: "Provider" })),
  });

  pi.registerTool({
    name: "explorers_contract",
    label: "Explorers Contract",
    description:
      "Get smart-contract verification, compiler, token, creator, and proxy metadata from the selected explorer.",
    parameters: contractParameters,
    approval: "read",
    renderCall(args, _options, _theme) {
      return new Text(sanitizeTerminalText(`Contract: ${args.address}`), 0, 0);
    },
    async execute(_toolCallId, params) {
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

  const gasParameters = Type.Object({
    chain: Type.Optional(Type.String({ description: "Chain" })),
    provider: Type.Optional(Type.String({ description: "Provider" })),
  });

  pi.registerTool({
    name: "explorers_gas",
    label: "Explorers Gas",
    description:
      "Get current safe, average, priority, fast, and base gas prices when the selected explorer exposes them.",
    parameters: gasParameters,
    approval: "read",
    renderCall(args, _options, _theme) {
      return new Text(
        sanitizeTerminalText(`Gas prices: ${args.chain ?? "provider default"}`),
        0,
        0,
      );
    },
    async execute(_toolCallId, params) {
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

  const providersParameters = Type.Object({});

  pi.registerTool({
    name: "explorers_providers",
    label: "Explorers Providers",
    description:
      "List registered block explorer provider keys accepted by the other explorer tools.",
    parameters: providersParameters,
    approval: "read",
    renderCall(_args, _options, _theme) {
      return new Text("List Explorers providers", 0, 0);
    },
    async execute() {
      const lib = await loadLib();
      const names = lib.providers();
      return textResult(`Registered providers (${names.length}):\n  ${names.join("\n  ")}`);
    },
  });
}
