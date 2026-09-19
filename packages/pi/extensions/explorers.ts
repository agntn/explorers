/** Pi extension: Explorers — unified block explorer tools */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type * as ExplorersModule from "../../../src/index.js";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

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

/** Control bytes a terminal would obey, plus every line break: a field must not add a line. */
/* oxlint-disable-next-line no-control-regex */
const UNSAFE_TERMINAL_CONTROLS = /[\u0000-\u0008\u000A-\u001F\u007F-\u009F\u2028\u2029]/gu;

/* Keep one line of tool output on one line, with nothing in it a terminal would obey. */
function sanitizeTerminalText(text: string): string {
  return text.replace(UNSAFE_TERMINAL_CONTROLS, "");
}

/* Join the lines a renderer composed, each sanitized on its own; a null line is one it left out. */
function joinLines(lines: readonly (string | null)[]): string {
  return lines
    .filter((line) => line !== null)
    .map(sanitizeTerminalText)
    .join("\n");
}

/* One OP_RETURN payload as result lines; its own breaks indent, so none can pose as a field. */
function describeOpReturn(payload: Readonly<ExplorersModule.OpReturnPayload>): string[] {
  const [first = "", ...rest] = (payload.text ?? payload.hex).split("\n");
  return [`OP_RETURN: ${first}`, ...rest.map((line) => `  ${line}`)];
}

interface TxDetailToolDetails {
  provider: string;
  transaction: ExplorersModule.Transaction;
}

type TxDetailToolResult = AgentToolResult<TxDetailToolDetails>;

interface ProvidersToolDetails {
  providers: ExplorersModule.ProviderListing[];
}

type ProvidersToolResult = AgentToolResult<ProvidersToolDetails>;

type ExplorersToolResult = AgentToolResult<undefined>;

function textResult(lines: readonly (string | null)[]): ExplorersToolResult {
  return {
    content: [{ type: "text", text: joinLines(lines) }],
    details: undefined,
  };
}

type SelectedProvider = ExplorersModule.ProviderContext & {
  readonly lib: typeof ExplorersModule;
};

async function withSelected<T>(
  preferred: string | undefined,
  requestedChain: string | undefined,
  capability: ExplorersModule.ProviderCapability,
  /* oxlint-disable-next-line typescript/prefer-readonly-parameter-types */
  run: (selected: SelectedProvider) => Promise<T>,
): Promise<T> {
  const lib = await loadLib();
  const chain = requestedChain === undefined ? undefined : lib.normalizeChain(requestedChain);
  return lib.withProvider(preferred, chain, (selected) => run({ ...selected, lib }), capability);
}

function balanceContext(balance: Readonly<ExplorersModule.Balance>): string {
  const block = balance.blockNumber === null ? "block unknown" : `block ${balance.blockNumber}`;
  const hash = balance.blockHash === null ? "" : `; hash ${balance.blockHash}`;
  return `; fetched ${balance.fetchedAt}; ${block}${hash}`;
}

async function resolveAddress(
  resolveAddresses: typeof ExplorersModule.resolveAddresses,
  input: string,
  chain: ExplorersModule.ChainKey,
): Promise<string> {
  const [address] = await resolveAddresses(input, chain);
  if (address === undefined) throw new TypeError("Address resolution returned no result");
  return address;
}

/* One line per output: the outpoint, its value, and the block that funded it. */
function describeUtxo(utxo: Readonly<ExplorersModule.Utxo>): string {
  const position = utxo.confirmed ? `block ${utxo.blockNumber ?? "unknown"}` : "pending";
  return `  ${utxo.txid}:${utxo.vout}  ${utxo.valueFormatted} (${utxo.value} base units)  [${position}]`;
}

function describeUtxos(
  name: string,
  address: string,
  chain: ExplorersModule.ChainKey,
  utxos: readonly Readonly<ExplorersModule.Utxo>[],
): string[] {
  const confirmed = utxos.filter((utxo) => utxo.confirmed);
  const total = confirmed.reduce((sum, utxo) => sum + BigInt(utxo.value), 0n);
  const pending = utxos.length - confirmed.length;
  const suffix = pending > 0 ? `, ${pending} pending` : "";
  const header = `[${name}] ${utxos.length} unspent outputs for ${address} on ${chain}, ${total} base units confirmed${suffix}:`;
  return [header, ...utxos.map(describeUtxo)];
}

/* The header's count is every holding; the suffix appears only when the list stops short of it. */
function listedCount(listed: number, total: number): string {
  return listed < total ? `, ${listed} listed` : "";
}

/* One line per provider: supported operations, declared chains, and the public endpoint. */
function describeProvider(listing: Readonly<ExplorersModule.ProviderListing>): string {
  const operations =
    listing.capabilities === undefined
      ? "capabilities not declared"
      : Object.entries(listing.capabilities)
          .filter(([, supported]) => supported)
          .map(([capability]) => capability)
          .join(", ") || "no supported explorer operations";
  const chains = listing.chains.join(", ") || "none";
  const endpoint = listing.defaultUrl === undefined ? "" : `; endpoint: ${listing.defaultUrl}`;
  return `${listing.name}: ${operations}; chains: ${chains}${endpoint}`;
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
      return withSelected(
        params.provider,
        params.chain,
        "balances",
        async ({ chain, lib, name, provider }) => {
          const addresses = await lib.resolveAddresses(params.address, chain);
          const balances = await Promise.all(
            addresses.map((address) => provider.getBalance(address, chain)),
          );
          const lines = balances.map((balance) => {
            const unconfirmed =
              balance.unconfirmed === undefined
                ? ""
                : `; unconfirmed delta ${balance.unconfirmed} base units`;
            const totals =
              balance.funded === undefined || balance.spent === undefined
                ? ""
                : `; funded ${balance.funded}, spent ${balance.spent}`;
            return `[${name}] ${balance.chain} balance for ${balance.address}: ${balance.balanceFormatted} ${balance.symbol} (${balance.balance} base units${totals}${unconfirmed}${balanceContext(balance)})`;
          });
          return textResult(lines);
        },
      );
    },
  });

  pi.registerTool({
    name: "explorers_tx_history",
    label: "Explorers Tx History",
    description: "Get transaction history for a blockchain address",
    promptSnippet: "Use to list recent transactions for any address.",
    promptGuidelines: [
      "Use explorers_tx_history with a blockchain address or ENS name and optionally a chain and limit.",
      "explorers_tx_history returns normalized transactions with from, to, value, and status.",
      "explorers_tx_history defaults to 10 results.",
    ],
    parameters: Type.Object({
      address: Type.String({ description: "Blockchain address or ENS name" }),
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
      return withSelected(
        params.provider,
        params.chain,
        "txHistory",
        async ({ chain, lib, name, provider }) => {
          const address = await resolveAddress(lib.resolveAddresses, params.address, chain);
          const txs = await provider.getTxHistory(address, chain, { limit: params.limit });
          const lines = txs.map(
            (tx) => `${tx.hash} ${tx.from}→${tx.to ?? "new"} ${tx.valueFormatted} [${tx.status}]`,
          );
          return textResult([`[${name}] ${txs.length} transactions on ${chain}:`, ...lines]);
        },
      );
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
      return withSelected(
        params.provider,
        params.chain,
        "txDetail",
        async ({ chain, lib, name, provider }) => {
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
            ...(tx.opReturn ?? []).flatMap(describeOpReturn),
          ];
          return {
            content: [{ type: "text", text: joinLines(parts) }],
            details: { provider: name, transaction: tx },
          };
        },
      );
    },
    renderResult(result, { expanded, isPartial }, theme) {
      if (isPartial) return new Text(theme.fg("warning", "Loading transaction…"), 0, 0);

      const details = result.details;
      if (!details) {
        const content = result.content.find((part) => part.type === "text");
        return new Text(
          theme.fg(
            "error",
            joinLines((content?.text ?? "Transaction details unavailable").split("\n")),
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
          const [first = "", ...rest] = (payload.text ?? payload.hex)
            .split("\n")
            .map(sanitizeTerminalText);
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
    name: "explorers_utxos",
    label: "Explorers UTXOs",
    description: "List the unspent outputs a Bitcoin-like address still controls",
    promptSnippet:
      "Use to see which outputs an address can still spend, when a balance total is not enough.",
    promptGuidelines: [
      "Use explorers_utxos with a Bitcoin, Litecoin or Pepecoin address and its chain to prove which outputs it still controls.",
      "explorers_utxos returns every unspent output as txid:vout with its value in base units and whether its funding transaction is confirmed.",
    ],
    parameters: Type.Object({
      address: Type.String({ description: "Blockchain address" }),
      chain: Type.Optional(Type.String({ description: "Chain" })),
      provider: Type.Optional(Type.String({ description: "Provider" })),
    }),
    renderCall(args, _theme) {
      return new Text(
        sanitizeTerminalText(
          `🧾 Unspent outputs: ${args.address} (${args.chain ?? "provider default"})`,
        ),
        0,
        0,
      );
    },
    async execute(_toolCallId, params): Promise<ExplorersToolResult> {
      return withSelected(
        params.provider,
        params.chain,
        "utxos",
        async ({ chain, lib, name, provider }) => {
          if (!provider.capabilities.utxos || !provider.getUtxos) {
            throw new lib.UnsupportedOperationError("getUtxos", name);
          }
          const address = await resolveAddress(lib.resolveAddresses, params.address, chain);
          const utxos = await provider.getUtxos(address, chain);
          return textResult(describeUtxos(name, address, chain, utxos));
        },
      );
    },
  });

  pi.registerTool({
    name: "explorers_contract",
    label: "Explorers Contract",
    description: "Get smart-contract metadata, verification, and proxy status",
    promptSnippet: "Use to check whether a contract is verified or acts as a proxy.",
    promptGuidelines: [
      "Use explorers_contract with a contract address or ENS name and optionally a chain.",
      "explorers_contract returns verification, compiler, token, creator, and proxy metadata.",
    ],
    parameters: Type.Object({
      address: Type.String({ description: "Contract address or ENS name" }),
      chain: Type.Optional(Type.String({ description: "Chain" })),
      provider: Type.Optional(Type.String({ description: "Provider" })),
    }),
    renderCall(args, _theme) {
      return new Text(sanitizeTerminalText(`📋 Contract: ${args.address}`), 0, 0);
    },
    async execute(_toolCallId, params): Promise<ExplorersToolResult> {
      return withSelected(
        params.provider,
        params.chain,
        "contractInfo",
        async ({ chain, lib, name, provider }) => {
          if (!provider.capabilities.contractInfo || !provider.getContractInfo) {
            throw new lib.UnsupportedOperationError("getContractInfo", name);
          }
          const address = await resolveAddress(lib.resolveAddresses, params.address, chain);
          const info = await provider.getContractInfo(address, chain);
          const parts = [
            `[${name}] Contract ${info.address}`,
            `Verified: ${info.isVerified}`,
            info.name ? `Name: ${info.name}` : null,
            info.compilerVersion ? `Compiler: ${info.compilerVersion}` : null,
            info.isProxy ? `Proxy → ${info.implementationAddress}` : null,
            info.isToken ? "Is token: yes" : null,
            info.creator ? `Creator: ${info.creator}` : null,
          ];
          return textResult(parts);
        },
      );
    },
  });

  pi.registerTool({
    name: "explorers_tokens",
    label: "Explorers Tokens",
    description: "List token holdings for a blockchain address",
    promptSnippet: "Use to read ERC-20 and other token balances, not just the native coin.",
    promptGuidelines: [
      "Use explorers_tokens with a blockchain address or ENS name and optionally a chain and limit.",
      "explorers_tokens returns each holding with its contract, symbol, and human-readable balance.",
      "explorers_tokens drops zero balances unless nonZeroOnly is false.",
      "explorers_tokens lists 50 holdings in the explorer's order unless limit says otherwise; the first line counts every holding.",
    ],
    parameters: Type.Object({
      address: Type.String({ description: "Blockchain address or ENS name" }),
      chain: Type.Optional(Type.String({ description: "Chain" })),
      limit: Type.Optional(
        Type.Integer({
          description: "Maximum number of holdings listed; the first line counts them all",
          minimum: 1,
          maximum: 100,
          default: 50,
        }),
      ),
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
      return withSelected(
        params.provider,
        params.chain,
        "tokenBalances",
        async ({ chain, lib, name, provider }) => {
          if (!provider.capabilities.tokenBalances || !provider.getTokenBalances) {
            throw new lib.UnsupportedOperationError("getTokenBalances", name);
          }
          const address = await resolveAddress(lib.resolveAddresses, params.address, chain);
          const holdings = await provider.getTokenBalances(address, chain, {
            nonZeroOnly: params.nonZeroOnly ?? true,
          });
          const tokens = holdings.slice(0, lib.clampMaxResults(params.limit ?? 50));
          const lines = tokens.map((token) => {
            const usd = token.valueUsd ? ` ($${token.valueUsd.toFixed(2)})` : "";
            return `  ${token.symbol}: ${token.balanceFormatted}${usd}  [${token.contract}]`;
          });
          return textResult([
            `[${name}] ${holdings.length} tokens for ${params.address} on ${chain}${listedCount(tokens.length, holdings.length)}:`,
            ...lines,
          ]);
        },
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
      "Use explorers_token_transfers with a blockchain address or ENS name and optionally a chain, limit, and token contract.",
      "explorers_token_transfers also lists transfers a third party sent to the address.",
      "explorers_token_transfers defaults to 10 results.",
    ],
    parameters: Type.Object({
      address: Type.String({ description: "Blockchain address or ENS name" }),
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
      return withSelected(
        params.provider,
        params.chain,
        "tokenTransfers",
        async ({ chain, lib, name, provider }) => {
          if (!provider.capabilities.tokenTransfers || !provider.getTokenTransfers) {
            throw new lib.UnsupportedOperationError("getTokenTransfers", name);
          }
          const address = await resolveAddress(lib.resolveAddresses, params.address, chain);
          const transfers = await provider.getTokenTransfers(address, chain, {
            limit: params.limit ?? 10,
            token: params.token,
          });
          const lines = transfers.map(
            (transfer) =>
              `  ${transfer.txHash} ${transfer.from}→${transfer.to} ${transfer.valueFormatted} ${transfer.symbol}`,
          );
          return textResult([
            `[${name}] ${transfers.length} token transfers for ${params.address} on ${chain}:`,
            ...lines,
          ]);
        },
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
      return withSelected(
        params.provider,
        params.chain,
        "gasData",
        async ({ chain, lib, name, provider }) => {
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
          ];
          return textResult(parts);
        },
      );
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
      return withSelected(
        params.provider,
        params.chain,
        "blockInfo",
        async ({ chain, lib, name, provider }) => {
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
          ];
          return textResult(parts);
        },
      );
    },
  });

  pi.registerTool({
    name: "explorers_providers",
    label: "Explorers Providers",
    description:
      "List registered block explorer providers with their chains, capabilities, and endpoints",
    promptSnippet:
      "Use to check which block explorer providers are available and what each one can read.",
    promptGuidelines: [
      "Use explorers_providers to list provider keys accepted by the other explorer tools.",
      "explorers_providers reports each provider's chains, supported operations, and public endpoint from registry metadata, without contacting any explorer.",
    ],
    parameters: Type.Object({}),
    renderCall(_args, _theme) {
      return new Text("🔍 List Explorers providers", 0, 0);
    },
    async execute(): Promise<ProvidersToolResult> {
      const lib = await loadLib();
      const providers = lib.listProviders();
      const lines = providers.map((listing) => `  ${describeProvider(listing)}`);
      return {
        content: [
          {
            type: "text",
            text: joinLines([`Registered providers (${providers.length}):`, ...lines]),
          },
        ],
        details: { providers },
      };
    },
  });
}
