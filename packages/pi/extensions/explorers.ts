/** Pi extension: Explorers — unified block explorer tools */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type * as ExplorersModule from "../../../src/index.js";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

type ChainResolver = {
  readonly PROVIDER_DEFAULT_CHAIN: Readonly<typeof ExplorersModule.PROVIDER_DEFAULT_CHAIN>;
  readonly normalizeChain: typeof ExplorersModule.normalizeChain;
};

const sourceModuleUrl = new URL("../../../src/index.ts", import.meta.url);
const distributionModuleUrl = new URL("../../../dist/index.mjs", import.meta.url);
let explorersModulePromise: Promise<typeof ExplorersModule> | undefined;

/**
 * Return live source in a checkout, otherwise the built module shipped in the package.
 *
 * @returns {string} The resulting value.
 */
export function resolveExplorersModuleUrl(): string {
  return existsSync(fileURLToPath(sourceModuleUrl))
    ? sourceModuleUrl.href
    : distributionModuleUrl.href;
}

/* Load the library from one unambiguous graph and retry after a failed import. */
function loadLib(): Promise<typeof ExplorersModule> {
  explorersModulePromise ??= (
    import(resolveExplorersModuleUrl()) as Promise<typeof ExplorersModule>
  ).catch((error: unknown) => {
    explorersModulePromise = undefined;
    throw error;
  });

  return explorersModulePromise;
}

/** Terminal control bytes that must not reach the TUI from tool arguments or explorer responses. */
/* oxlint-disable-next-line no-control-regex */
const UNSAFE_TERMINAL_CONTROLS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/gu;

/* Drop control bytes so an explorer response cannot inject ANSI or OSC sequences into the terminal. */
function sanitizeTerminalText(text: string): string {
  return text.replace(UNSAFE_TERMINAL_CONTROLS, "");
}

interface TxDetailToolDetails {
  provider: string;
  transaction: ExplorersModule.Transaction;
}

type TxDetailToolResult = AgentToolResult<TxDetailToolDetails>;

type ExplorersToolResult = AgentToolResult<undefined>;

function textResult(text: string): ExplorersToolResult {
  return {
    content: [{ type: "text", text: sanitizeTerminalText(text) }],
    details: undefined,
  };
}

async function getProvider(
  preferred: string | undefined,
  requestedChain: string | undefined,
  capability: ExplorersModule.ProviderCapability,
) {
  const lib = await loadLib();
  const chain = requestedChain === undefined ? undefined : lib.normalizeChain(requestedChain);
  const name = lib.resolveProvider(preferred, chain, capability);
  return { lib, name, provider: await lib.create(name) };
}

function resolveToolChain(lib: ChainResolver, providerName: string, requested?: string) {
  return lib.normalizeChain(requested ?? lib.PROVIDER_DEFAULT_CHAIN[providerName]);
}

function balanceContext(balance: Readonly<ExplorersModule.Balance>): string {
  const block = balance.blockNumber === null ? "block unknown" : `block ${balance.blockNumber}`;
  const hash = balance.blockHash === null ? "" : `; hash ${balance.blockHash}`;
  return `; fetched ${balance.fetchedAt}; ${block}${hash}`;
}

export default function explorersExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "explorers_balance",
    label: "Explorers Balance",
    description: "Get native-token balances for one or more blockchain addresses",
    promptSnippet: "Use to check ETH, BTC, or other native-token balances across chains.",
    promptGuidelines: [
      "Use explorers_balance with a blockchain address, or a list of addresses to batch, and optionally a chain.",
      "explorers_balance defaults to Ethereum mainnet when neither provider nor chain is explicit.",
      "explorers_balance returns raw and human-readable balances with the read time and available block position.",
    ],
    parameters: Type.Object({
      address: Type.Union(
        [
          Type.String({ minLength: 1, pattern: "\\S" }),
          Type.Array(Type.String({ minLength: 1, pattern: "\\S" }), {
            minItems: 1,
            maxItems: 20,
          }),
        ],
        { description: "Blockchain address or ENS name, or a list of them to check in one call" },
      ),
      chain: Type.Optional(
        Type.String({
          description: "Chain (ethereum, base, arbitrum, bitcoin, solana, ...)",
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
      const label = Array.isArray(args.address) ? `${args.address.length} addresses` : args.address;
      return new Text(
        sanitizeTerminalText(`🔍 Balance: ${label} (${args.chain ?? "provider default"})`),
        0,
        0,
      );
    },
    async execute(_toolCallId, params): Promise<ExplorersToolResult> {
      const lib = await loadLib();
      const requestedChain =
        params.chain === undefined ? undefined : lib.normalizeChain(params.chain);
      return lib.withProvider(
        params.provider,
        requestedChain,
        async ({ chain, name, provider }) => {
          const addresses = await lib.resolveAddresses(params.address, chain);
          const balances = await Promise.all(
            addresses.map((address) => provider.getBalance(address, chain)),
          );
          const lines = balances.map((balance) => {
            const totals =
              balance.funded === undefined || balance.spent === undefined
                ? ""
                : `; funded ${balance.funded}, spent ${balance.spent}`;
            return `[${name}] ${balance.chain} balance for ${balance.address}: ${balance.balanceFormatted} ${balance.symbol} (${balance.balance} base units${totals}${balanceContext(balance)})`;
          });
          return textResult(lines.join("\n"));
        },
        "balances",
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
      return new Text(
        sanitizeTerminalText(`📜 Tx history: ${args.address} (limit: ${args.limit ?? 10})`),
        0,
        0,
      );
    },
    async execute(_toolCallId, params): Promise<ExplorersToolResult> {
      const { lib, name, provider } = await getProvider(params.provider, params.chain, "txHistory");
      const chain = resolveToolChain(lib, name, params.chain);
      const txs = await provider.getTxHistory(params.address, chain, { limit: params.limit });

      const lines = txs.map(
        (tx) => `${tx.hash} ${tx.from}→${tx.to ?? "new"} ${tx.valueFormatted} [${tx.status}]`,
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
      "explorers_tx_detail reads OP_RETURN messages through the mempool provider, so ask for it by name when a Bitcoin transaction carries one.",
    ],
    parameters: Type.Object({
      hash: Type.String({ description: "Transaction hash" }),
      chain: Type.Optional(Type.String({ description: "Chain" })),
      provider: Type.Optional(Type.String({ description: "Provider" })),
    }),
    renderCall(args, _theme) {
      return new Text(sanitizeTerminalText(`🔬 Tx detail: ${args.hash.slice(0, 18)}…`), 0, 0);
    },
    async execute(_toolCallId, params): Promise<TxDetailToolResult> {
      const { lib, name, provider } = await getProvider(params.provider, params.chain, "txDetail");
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
        ...(tx.opReturn ?? []).map((payload) => `OP_RETURN: ${payload.text ?? payload.hex}`),
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
      const opReturnLines = (): string[] => {
        const lines: string[] = [];
        for (const payload of tx.opReturn ?? []) {
          const message = sanitizeTerminalText(payload.text ?? payload.hex);
          const [first = "", ...rest] = message.split("\n");
          lines.push(`${theme.fg("muted", "OP_RETURN")} ${first}`);
          for (const line of rest) lines.push(`  ${line}`);
        }
        return lines;
      };
      const expandedLines = (): string[] => {
        const lines: string[] = [];
        if (tx.fee) {
          lines.push(`${theme.fg("muted", "Fee")} ${sanitizeTerminalText(tx.fee)} base units`);
        }
        lines.push(
          `${theme.fg("muted", "From")} ${sanitizeTerminalText(tx.from)}`,
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
        lines.push(...opReturnLines());
        return lines;
      };
      const lines = [
        `${theme.fg("muted", sanitizeTerminalText(`[${details.provider}]`))} ${theme.fg("accent", sanitizeTerminalText(tx.hash))}`,
        `${theme.fg("muted", "Block")} ${sanitizeTerminalText(String(tx.blockNumber))}  ${theme.fg("muted", "Status")} ${theme.fg(statusColor, sanitizeTerminalText(tx.status))}`,
        `${theme.fg("muted", "Value")} ${sanitizeTerminalText(tx.valueFormatted)}`,
      ];
      if (expanded) lines.push(...expandedLines());

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
      return new Text(sanitizeTerminalText(`📋 Contract: ${args.address}`), 0, 0);
    },
    async execute(_toolCallId, params): Promise<ExplorersToolResult> {
      const { lib, name, provider } = await getProvider(
        params.provider,
        params.chain,
        "contractInfo",
      );
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
    name: "explorers_tokens",
    label: "Explorers Tokens",
    description: "List token holdings for a blockchain address",
    promptSnippet: "Use to read ERC-20 and other token balances, not just the native coin.",
    promptGuidelines: [
      "Use explorers_tokens with a blockchain address and optionally a chain.",
      "explorers_tokens returns each holding with its contract, symbol, and human-readable balance.",
      "explorers_tokens drops zero balances unless nonZeroOnly is false.",
    ],
    parameters: Type.Object({
      address: Type.String({ description: "Blockchain address" }),
      chain: Type.Optional(Type.String({ description: "Chain" })),
      nonZeroOnly: Type.Optional(
        Type.Boolean({ description: "Drop holdings whose balance is zero", default: true }),
      ),
      provider: Type.Optional(Type.String({ description: "Provider" })),
    }),
    renderCall(args, _theme) {
      return new Text(
        sanitizeTerminalText(`🪙 Tokens: ${args.address} (${args.chain ?? "provider default"})`),
        0,
        0,
      );
    },
    async execute(_toolCallId, params): Promise<ExplorersToolResult> {
      const { lib, name, provider } = await getProvider(
        params.provider,
        params.chain,
        "tokenBalances",
      );
      const chain = resolveToolChain(lib, name, params.chain);
      if (!provider.capabilities.tokenBalances || !provider.getTokenBalances) {
        throw new lib.UnsupportedOperationError("getTokenBalances", name);
      }
      const tokens = await provider.getTokenBalances(params.address, chain, {
        nonZeroOnly: params.nonZeroOnly ?? true,
      });

      const lines = tokens.map((token) => {
        const usd = token.valueUsd ? ` ($${token.valueUsd.toFixed(2)})` : "";
        return `  ${token.symbol}: ${token.balanceFormatted}${usd}  [${token.contract.slice(0, 10)}…]`;
      });

      return textResult(
        `[${name}] ${tokens.length} tokens for ${params.address} on ${chain}:\n${lines.join("\n")}`,
      );
    },
  });

  pi.registerTool({
    name: "explorers_token_transfers",
    label: "Explorers Token Transfers",
    description: "List fungible-token transfers involving an address",
    promptSnippet:
      "Use to see incoming token payments an address never spent, which its native history hides.",
    promptGuidelines: [
      "Use explorers_token_transfers with a blockchain address and optionally a chain, limit, and token contract.",
      "explorers_token_transfers also lists transfers a third party sent to the address.",
      "explorers_token_transfers defaults to 10 results.",
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
      token: Type.Optional(Type.String({ description: "Only transfers of this token contract" })),
    }),
    renderCall(args, _theme) {
      return new Text(
        sanitizeTerminalText(`💸 Token transfers: ${args.address} (limit: ${args.limit ?? 10})`),
        0,
        0,
      );
    },
    async execute(_toolCallId, params): Promise<ExplorersToolResult> {
      const { lib, name, provider } = await getProvider(
        params.provider,
        params.chain,
        "tokenTransfers",
      );
      const chain = resolveToolChain(lib, name, params.chain);
      if (!provider.capabilities.tokenTransfers || !provider.getTokenTransfers) {
        throw new lib.UnsupportedOperationError("getTokenTransfers", name);
      }
      const transfers = await provider.getTokenTransfers(params.address, chain, {
        limit: params.limit ?? 10,
        token: params.token,
      });

      const lines = transfers.map(
        (transfer) =>
          `  ${transfer.txHash.slice(0, 18)}… ${transfer.from.slice(0, 10)}…→${transfer.to.slice(0, 10)}… ${transfer.valueFormatted} ${transfer.symbol}`,
      );

      return textResult(
        `[${name}] ${transfers.length} token transfers for ${params.address} on ${chain}:\n${lines.join("\n")}`,
      );
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
      return new Text(
        sanitizeTerminalText(`⛽ Gas prices: ${args.chain ?? "provider default"}`),
        0,
        0,
      );
    },
    async execute(_toolCallId, params): Promise<ExplorersToolResult> {
      const { lib, name, provider } = await getProvider(params.provider, params.chain, "gasData");
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
    name: "explorers_block",
    label: "Explorers Block",
    description: "Get block information by block number",
    promptSnippet: "Use to read one block by its number.",
    promptGuidelines: [
      "Use explorers_block with a block number and optionally a chain.",
      "explorers_block returns hash, timestamp, miner, gas usage, and transaction count.",
    ],
    parameters: Type.Object({
      blockNumber: Type.Integer({ description: "Block number", minimum: 0 }),
      chain: Type.Optional(Type.String({ description: "Chain" })),
      provider: Type.Optional(Type.String({ description: "Provider" })),
    }),
    renderCall(args, _theme) {
      return new Text(
        sanitizeTerminalText(
          `🧱 Block: #${args.blockNumber} (${args.chain ?? "provider default"})`,
        ),
        0,
        0,
      );
    },
    async execute(_toolCallId, params): Promise<ExplorersToolResult> {
      const { lib, name, provider } = await getProvider(params.provider, params.chain, "blockInfo");
      const chain = resolveToolChain(lib, name, params.chain);
      if (!provider.capabilities.blockInfo || !provider.getBlockInfo) {
        throw new lib.UnsupportedOperationError("getBlockInfo", name);
      }
      const block = await provider.getBlockInfo(params.blockNumber, chain);

      const parts = [
        `[${name}] Block #${block.number} on ${chain}`,
        `Hash: ${block.hash}`,
        `Timestamp: ${block.timestamp}`,
        `Miner: ${block.miner}`,
        `Gas used/limit: ${block.gasUsed} / ${block.gasLimit}`,
        `Transactions: ${block.txCount}`,
        block.baseFee ? `Base fee per gas: ${block.baseFee}` : null,
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
