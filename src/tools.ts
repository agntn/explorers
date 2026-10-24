/**
 * The explorer tools, declared once for MCP, Pi, OMP and the CLI. Executors and the provider graph
 * load on the first call. `Type` comes from `@agntn/tools`, never a bare `typebox`: OMP rewrites
 * that import to its own facade, and validation then accepts any value.
 */
import { defineTool, sanitizeLine, Type, type ToolDefinition } from "@agntn/tools";
import {
  HISTORY_LIMIT,
  MAX_ADDRESS_BATCH,
  MAX_LIMIT,
  TOKEN_HOLDINGS_LIMIT,
  UNSPENT_OUTPUTS_LIMIT,
} from "./tool-limits.ts";

export { describeResult, terminalLines } from "./tool-lines.ts";

type Operations = typeof import("./tool-operations.ts");

let operations: Promise<Operations> | undefined;

/**
 * Loads the executors once. A failed load isn't cached, so a broken `dist` doesn't stick.
 *
 * @returns {Promise<Operations>} The executors.
 */
export function loadOperations(): Promise<Operations> {
  operations ??= import("./tool-operations.ts").catch((error: unknown) => {
    operations = undefined;
    throw error;
  });
  return operations;
}

let tools: readonly ToolDefinition[] | undefined;
let commands: readonly ToolDefinition[] | undefined;

/**
 * The explorer tools every surface gets, built on the first call so an import builds no schema.
 *
 * @returns {readonly ToolDefinition[]} The eleven tools, providers first.
 */
export function explorersTools(): readonly ToolDefinition[] {
  tools ??= defineTools();
  return tools;
}

/**
 * Commands only the CLI gets: `balance` takes its addresses as words, `tx` reads a hash or an address.
 *
 * @returns {readonly ToolDefinition[]} The two commands, built once.
 */
export function explorersCommands(): readonly ToolDefinition[] {
  commands ??= defineCommands();
  return commands;
}

/** Read-only and over the network, the effect of every explorer tool. */
const reading = { effect: "read", openWorld: true } as const;

/** Short flags the old citty commands had, kept so `-c btc -n 5` still reads. */
const SHORT_FLAGS = { chain: "c", provider: "p", limit: "n", token: "t", mode: "m" } as const;

/**
 * The short flags of one command: the route's, plus those of the extra fields it takes.
 *
 * @param extra - Fields beyond chain and provider that have a short flag.
 * @returns {Record<string, string>} Letters by property.
 */
function shortFlags(...extra: ReadonlyArray<"limit" | "token" | "mode">): Record<string, string> {
  return Object.fromEntries(
    (["chain", "provider", ...extra] as const).map((key) => [key, SHORT_FLAGS[key]]),
  );
}

/**
 * A text field nobody may leave blank. OMP drops `""` from a field with `minLength` before the call.
 *
 * @param description - What the field holds.
 * @returns {TString} The schema.
 */
function text(description: string) {
  return Type.String({ description, minLength: 1, pattern: "\\S" });
}

/**
 * A count, bound or page where `0` means "not given": OMP fills an unused number with `0` and
 * refuses the call outright when that falls below `minimum`.
 *
 * @param description - What the number holds.
 * @param maximum - Its upper bound, if any.
 * @returns {TOptional<TInteger>} The optional schema.
 */
function count(description: string, maximum?: number) {
  return Type.Optional(
    Type.Integer({ description, minimum: 0, ...(maximum === undefined ? {} : { maximum }) }),
  );
}

/**
 * Schemas the tools share, built inside `defineTools` so loading the module builds none.
 *
 * @returns {object} The shared fields.
 */
function fields() {
  const route = {
    chain: Type.Optional(
      text(
        "Chain name or alias, such as eth, base, bitcoin or solana. Left out, an address that fits one chain picks it, else the provider's default.",
      ),
    ),
    provider: Type.Optional(
      text("Provider key from explorers_providers. Left out, the chain and the API keys pick one."),
    ),
  };
  const address = text("Blockchain address or ENS name");
  const sort = Type.Optional(
    Type.Enum(["asc", "desc"], {
      description: "Block order of the rows. Left out, the explorer's own order.",
      minLength: 1,
    }),
  );
  const blocks = {
    startBlock: count("Lowest block to include."),
    endBlock: count("Highest block to include."),
  };
  const history = {
    ...blocks,
    sort,
    limit: count(`Rows to list, at most ${MAX_LIMIT}. Defaults to ${HISTORY_LIMIT}.`, MAX_LIMIT),
    page: count("Page from 1, each limit rows long."),
  };
  const raw = Type.Optional(
    Type.Boolean({
      description:
        "Include the provider's own transaction record as raw, for fields the normalized shape leaves out, such as every input and output of a Bitcoin transaction. Defaults to false.",
    }),
  );
  return { route, address, history, raw };
}

/**
 * Every tool for every surface, with the MCP description, which is all an MCP client reads.
 *
 * @returns {ToolDefinition[]} The tools, providers first.
 */
function defineTools(): ToolDefinition[] {
  const { route, address, history, raw } = fields();
  return [
    defineTool({
      name: "explorers_providers",
      title: "List Explorer Providers",
      description:
        "List registered block explorer providers with the chains they serve, their capabilities, and their public endpoints",
      snippet:
        "Use to check which block explorer providers are available and what each one can read.",
      guidelines: [
        "Use explorers_providers to list provider keys accepted by the other explorer tools.",
        "explorers_providers reports each provider's chains, supported operations, and public endpoint from registry metadata, without contacting any explorer.",
      ],
      effect: "read",
      input: Type.Object({}, { additionalProperties: false }),
      cli: { description: "List providers with their chains, capabilities and endpoints" },
      execute: async () => (await loadOperations()).providers(),
    }),
    defineTool({
      name: "explorers_balance",
      title: "Get Balance",
      description:
        "Get the native-token balance for one or more blockchain addresses or ENS names, raw and formatted, with the read time and the block it reflects when the explorer names one",
      snippet: "Use to check ETH, BTC, or other native-token balances across chains.",
      guidelines: [
        "Use explorers_balance with a blockchain address, or a list of addresses to batch, and optionally a chain.",
        "explorers_balance infers the chain from an address whose format fits only one chain, such as Bitcoin or Solana; EVM addresses and ENS names default to Ethereum mainnet when neither provider nor chain is explicit.",
        "explorers_balance returns raw and human-readable balances with the read time and available block position.",
      ],
      ...reading,
      input: Type.Object(
        {
          address: Type.Union(
            [address, Type.Array(address, { minItems: 1, maxItems: MAX_ADDRESS_BATCH })],
            {
              description: `Blockchain address or ENS name, or a list of up to ${MAX_ADDRESS_BATCH} of them read in one call`,
            },
          ),
          ...route,
        },
        { additionalProperties: false },
      ),
      execute: async (args, { signal }) => (await loadOperations()).balance(args, signal),
    }),
    defineTool({
      name: "explorers_tx_history",
      title: "List Transactions",
      description: `List normalized transactions involving a blockchain address, ${HISTORY_LIMIT} unless limit says otherwise`,
      snippet: "Use to list recent transactions for any address.",
      guidelines: [
        "Use explorers_tx_history with a blockchain address or ENS name and optionally a chain and limit.",
        "explorers_tx_history returns normalized transactions with from, to, value, and status.",
        `explorers_tx_history defaults to ${HISTORY_LIMIT} results.`,
      ],
      ...reading,
      input: Type.Object(
        {
          address,
          ...route,
          ...history,
          tags: Type.Optional(
            Type.Array(
              Type.Object(
                {
                  name: Type.String({ minLength: 1 }),
                  values: Type.Array(Type.String(), { minItems: 1 }),
                },
                { additionalProperties: false },
              ),
              {
                description:
                  'Keep only transactions carrying these tags, e.g. [{ "name": "Content-Type", "values": ["text/plain"] }]. A tag matches any of its values, and every tag must match. Arweave only, other providers refuse it.',
              },
            ),
          ),
          raw,
        },
        { additionalProperties: false },
      ),
      cli: {
        description: "List the transactions of an address (supports ENS)",
        command: "tx-history",
        positional: ["address"],
        plain: ["address"],
        short: shortFlags("limit"),
      },
      execute: async (args, { signal }) => (await loadOperations()).txHistory(args, signal),
    }),
    defineTool({
      name: "explorers_tx_detail",
      title: "Get Transaction",
      description:
        "Get one normalized transaction by hash, with OP_RETURN messages on the Bitcoin family and Ordinals inscriptions from mempool and blockstream",
      snippet: "Use to inspect a single transaction by hash.",
      guidelines: [
        "Use explorers_tx_detail with a chain-native transaction hash and optionally a chain.",
        "explorers_tx_detail returns fees, status, method, and token transfers.",
        "explorers_tx_detail reads OP_RETURN messages on the whole Bitcoin family, and Ordinals inscriptions from mempool and blockstream.",
      ],
      ...reading,
      input: Type.Object(
        { hash: text("Transaction hash"), ...route, raw },
        { additionalProperties: false },
      ),
      cli: {
        description: "Read one transaction by hash",
        command: "tx-detail",
        positional: ["hash"],
        plain: ["hash"],
        short: shortFlags(),
      },
      execute: async (args, { signal }) => (await loadOperations()).txDetail(args, signal),
    }),
    defineTool({
      name: "explorers_utxos",
      title: "List Unspent Outputs",
      description: `List the unspent outputs a Bitcoin-like address still controls, each as txid and vout with its value in base units and confirmation state: the first ${UNSPENT_OUTPUTS_LIMIT} in the explorer's order unless limit says otherwise. total counts every output the list was cut from, confirmed sums the confirmed ones in base units, and pending counts those still in the mempool.`,
      snippet:
        "Use to see which outputs an address can still spend, when a balance total is not enough.",
      guidelines: [
        "Use explorers_utxos with an address and its chain (Bitcoin, Bitcoin Cash, Bitcoin SV, Bitcoin Gold, Litecoin or Pepecoin) to prove which outputs it still controls.",
        "explorers_utxos returns each unspent output as txid and vout with its value in base units and whether its funding transaction is confirmed.",
        `explorers_utxos lists ${UNSPENT_OUTPUTS_LIMIT} outputs in the explorer's order unless limit says otherwise; total counts every output and confirmed sums the confirmed ones.`,
      ],
      ...reading,
      input: Type.Object(
        {
          address,
          ...route,
          limit: count(
            `Outputs to list, at most ${MAX_LIMIT}; total still counts every output. Defaults to ${UNSPENT_OUTPUTS_LIMIT}.`,
            MAX_LIMIT,
          ),
        },
        { additionalProperties: false },
      ),
      cli: {
        description: "List the unspent outputs a Bitcoin-like address still controls",
        positional: ["address"],
        plain: ["address"],
        short: shortFlags("limit"),
      },
      execute: async (args, { signal }) => (await loadOperations()).utxos(args, signal),
    }),
    defineTool({
      name: "explorers_pubkey",
      title: "Find Public Key",
      description:
        "Tell whether a Bitcoin, Litecoin or Pepecoin address has shown its public key on chain. pubkey comes back as hex with the txid that showed it: source spend for an input spending from the address (P2PKH, P2WPKH, P2SH-wrapped P2WPKH), source output for a taproot address, which is its own key. A null pubkey beside spent true means a script this read does not parse, or a spend older than the newest 1000 transactions, 250 on Pepecoin where Peppool allows 15 requests a minute.",
      snippet:
        "Use before a Kangaroo or BSGS search, to learn whether the target address ever exposed its key.",
      guidelines: [
        "Use explorers_pubkey with a Bitcoin, Litecoin or Pepecoin address to read the public key a spend or a taproot output put on chain.",
        "explorers_pubkey names the txid that showed the key: a spend from P2PKH, P2WPKH or P2SH-wrapped P2WPKH, or the output paying a taproot address, which is its own key.",
        "explorers_pubkey with no key and a spent address means a script it doesn't parse, or a spend older than the newest 1000 transactions, 250 on Pepecoin where Peppool allows 15 requests a minute; an address that never spent shows no key in its own history.",
      ],
      ...reading,
      input: Type.Object({ address, ...route }, { additionalProperties: false }),
      cli: {
        description: "Tell whether an address has shown its public key on chain",
        positional: ["address"],
        plain: ["address"],
        short: shortFlags(),
      },
      execute: async (args, { signal }) => (await loadOperations()).pubkey(args, signal),
    }),
    defineTool({
      name: "explorers_contract",
      title: "Get Contract",
      description:
        "Get verification, compiler, creator, proxy and token metadata for a contract, plus its ABI and source on request",
      snippet: "Use to check whether a contract is verified or acts as a proxy.",
      guidelines: [
        "Use explorers_contract with a contract address or ENS name and optionally a chain.",
        "explorers_contract returns verification, compiler, token, creator, and proxy metadata; the ABI and source come only when abi or sourceCode asks for them.",
      ],
      ...reading,
      input: Type.Object(
        {
          address: text("Contract address or ENS name"),
          ...route,
          abi: Type.Optional(
            Type.Boolean({
              description:
                "Include the ABI of a verified contract as a JSON string. Defaults to false.",
            }),
          ),
          sourceCode: Type.Optional(
            Type.Boolean({
              description: "Include the source code of a verified contract. Defaults to false.",
            }),
          ),
        },
        { additionalProperties: false },
      ),
      cli: {
        description: "Get smart contract info (supports ENS)",
        positional: ["address"],
        plain: ["address"],
        short: shortFlags(),
      },
      execute: async (args, { signal }) => (await loadOperations()).contract(args, signal),
    }),
    defineTool({
      name: "explorers_tokens",
      title: "List Token Holdings",
      description: `List token holdings for a blockchain address: the first ${TOKEN_HOLDINGS_LIMIT} in the explorer's order unless limit says otherwise; total counts every holding the list was cut from. Zero balances are dropped unless nonZeroOnly is false.`,
      snippet: "Use to read ERC-20 and other token balances, not just the native coin.",
      guidelines: [
        "Use explorers_tokens with a blockchain address or ENS name and optionally a chain and limit.",
        "explorers_tokens returns each holding with its contract, symbol, and human-readable balance.",
        "explorers_tokens drops zero balances unless nonZeroOnly is false.",
        `explorers_tokens lists ${TOKEN_HOLDINGS_LIMIT} holdings in the explorer's order unless limit says otherwise; total counts every holding.`,
      ],
      ...reading,
      input: Type.Object(
        {
          address,
          ...route,
          nonZeroOnly: Type.Optional(
            Type.Boolean({ description: "Drop holdings whose balance is zero. Defaults to true." }),
          ),
          limit: count(
            `Holdings to list, at most ${MAX_LIMIT}; total still counts every holding. Defaults to ${TOKEN_HOLDINGS_LIMIT}.`,
            MAX_LIMIT,
          ),
        },
        { additionalProperties: false },
      ),
      cli: {
        description: "List fungible token holdings for an address (supports ENS)",
        positional: ["address"],
        plain: ["address"],
        short: shortFlags("limit"),
      },
      execute: async (args, { signal }) => (await loadOperations()).tokens(args, signal),
    }),
    defineTool({
      name: "explorers_token_transfers",
      title: "List Token Transfers",
      description: `List fungible-token transfers involving a blockchain address, including transfers sent to it by third parties that never show up in its native transaction history, ${HISTORY_LIMIT} unless limit says otherwise`,
      snippet:
        "Use to see incoming token payments an address never spent, which its native history hides.",
      guidelines: [
        "Use explorers_token_transfers with a blockchain address or ENS name and optionally a chain, limit, and token contract.",
        "explorers_token_transfers also lists transfers a third party sent to the address.",
        `explorers_token_transfers defaults to ${HISTORY_LIMIT} results.`,
      ],
      ...reading,
      input: Type.Object(
        {
          address,
          ...route,
          token: Type.Optional(text("Only transfers of this token contract")),
          ...history,
        },
        { additionalProperties: false },
      ),
      cli: {
        description: "List token transfers involving an address (supports ENS)",
        command: "transfers",
        positional: ["address"],
        plain: ["address"],
        short: shortFlags("limit", "token"),
      },
      execute: async (args, { signal }) => (await loadOperations()).tokenTransfers(args, signal),
    }),
    defineTool({
      name: "explorers_gas",
      title: "Get Gas Prices",
      description:
        "Get current gas or fee-market suggestions: safe, average, fast, priority and base prices where the explorer has them",
      snippet: "Use to check gas prices before sending a transaction.",
      guidelines: [
        "Use explorers_gas with a chain or the selected provider's default.",
        "explorers_gas returns safe, average, fast, priority, and base prices when available.",
      ],
      ...reading,
      input: Type.Object({ ...route }, { additionalProperties: false }),
      cli: {
        description: "Get current gas prices",
        short: shortFlags(),
      },
      execute: async (args, { signal }) => (await loadOperations()).gas(args, signal),
    }),
    defineTool({
      name: "explorers_block",
      title: "Get Block",
      description:
        "Get normalized block information by block number: hash, parent, timestamp, miner, gas usage and transaction count",
      snippet: "Use to read one block by its number.",
      guidelines: [
        "Use explorers_block with a block number and optionally a chain.",
        "explorers_block returns hash, timestamp, miner, gas usage, and transaction count.",
      ],
      ...reading,
      input: Type.Object(
        {
          blockNumber: Type.Integer({ description: "Block number", minimum: 0 }),
          ...route,
        },
        { additionalProperties: false },
      ),
      cli: {
        description: "Get block info by number",
        positional: ["blockNumber"],
        short: shortFlags(),
      },
      execute: async (args, { signal }) => (await loadOperations()).block(args, signal),
    }),
  ];
}

/**
 * `balance` and `tx` the way the old commands read: several address words, and one word that may
 * be a hash or an address.
 *
 * @returns {ToolDefinition[]} The two commands.
 */
function defineCommands(): ToolDefinition[] {
  const { route } = fields();
  return [
    defineTool({
      name: "explorers_balance",
      title: "Get Balance",
      description:
        "Get native token balances with read time for one or more addresses or ENS names; pass several to batch",
      ...reading,
      input: Type.Object(
        {
          addresses: Type.Array(text("Blockchain address or ENS name"), {
            description: "Addresses or ENS names",
            minItems: 1,
            maxItems: MAX_ADDRESS_BATCH,
          }),
          ...route,
        },
        { additionalProperties: false },
      ),
      cli: {
        description: "Get native balances with read time for one or more addresses (supports ENS)",
        rest: "addresses",
        plain: ["addresses"],
        short: shortFlags(),
      },
      execute: async ({ addresses, ...args }, { signal }) =>
        (await loadOperations()).balance(
          { ...args, address: addresses.length === 1 ? (addresses[0] ?? "") : addresses },
          signal,
        ),
    }),
    defineTool({
      name: "explorers_tx",
      title: "Get Transactions",
      description:
        "Get transaction history for an address or ENS name, or one transaction by hash; --mode settles a format both share",
      ...reading,
      input: Type.Object(
        {
          target: text("Address, ENS name or transaction hash"),
          ...route,
          mode: Type.Optional(
            Type.Enum(["history", "detail"], {
              description:
                "history or detail. Left out, a hash reads as detail and anything else as history.",
            }),
          ),
          limit: count(
            `Transactions a history lists, at most ${MAX_LIMIT}. Defaults to ${HISTORY_LIMIT}.`,
            MAX_LIMIT,
          ),
        },
        { additionalProperties: false },
      ),
      cli: {
        description: "Get transaction history or detail (supports ENS)",
        positional: ["target"],
        plain: ["target"],
        short: shortFlags("limit", "mode"),
      },
      execute: async (args, { signal }) => (await loadOperations()).tx(args, signal),
    }),
  ];
}

/** Longest argument a call summary shows. */
const PREVIEW_LENGTH = 80;

/**
 * One argument for a call summary, cut before cleaning: cleaning an unclosed escape is quadratic.
 *
 * @param value - Argument as the model sent it.
 * @returns {string} The value on one line, at most `PREVIEW_LENGTH` characters.
 */
function preview(value: unknown): string {
  const raw = Array.isArray(value) ? `${value.length} addresses` : String(value);
  const clean = sanitizeLine(raw.slice(0, PREVIEW_LENGTH * 2));
  return clean.length > PREVIEW_LENGTH ? `${clean.slice(0, PREVIEW_LENGTH - 1)}…` : clean;
}

/** Arguments a call summary names after the subject, in this order. */
const SUMMARY_FIELDS = ["chain", "provider", "token", "limit", "page"] as const;

/**
 * Summarizes a call for a host status line: what it reads, then each route argument the caller set.
 *
 * @param args - Arguments as the model sent them, not yet validated.
 * @returns {string} One line, empty for a call without arguments worth showing.
 */
export function describeCall(args: Readonly<Record<string, unknown>>): string {
  const subject = args["address"] ?? args["hash"] ?? args["blockNumber"];
  const parts = subject === undefined || subject === "" ? [] : [preview(subject)];
  for (const field of SUMMARY_FIELDS) {
    const value = args[field];
    if (value !== undefined && value !== "" && value !== 0)
      parts.push(`${field}=${preview(value)}`);
  }
  return parts.join(" ");
}
