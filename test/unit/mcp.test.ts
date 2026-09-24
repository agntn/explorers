import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Provider } from "../../src/core/provider.ts";
import type { ProviderConstructor } from "../../src/core/provider.ts";
import { create, register } from "../../src/core/registry.ts";
import { builtins } from "../../src/providers/index.ts";
import type {
  ChainKey,
  ContractInfo,
  TokenBalance,
  TokenBalanceOptions,
} from "../../src/core/types.ts";
import { createMcpServer } from "../../src/mcp.ts";

const openConnections: Array<{ close(): Promise<void> }> = [];

// SAFETY: create() instantiates the ProviderConstructor registered for this key.
const blockscoutConstructor = (await create("blockscout")).constructor as ProviderConstructor;
const blockscoutEntry = builtins.find((entry) => entry.key === "blockscout")!;

afterEach(async () => {
  register(blockscoutConstructor, blockscoutEntry);
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await Promise.all(openConnections.splice(0).map((connection) => connection.close()));
});

async function connectTestClient(): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer();
  const client = new Client({ name: "explorers-test", version: "1.0.0" });
  openConnections.push(client, server);
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

interface ToolContentView {
  readonly type: string;
  readonly text?: string;
}

interface ToolResultView {
  readonly content: readonly ToolContentView[];
  readonly isError: boolean;
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function parseToolResult(value: unknown): ToolResultView {
  if (typeof value !== "object" || value === null || !("content" in value)) {
    throw new TypeError("Tool returned no content array");
  }
  const contentValue = value.content;
  if (!isUnknownArray(contentValue)) throw new TypeError("Tool content is not an array");

  const content = contentValue.map((part): ToolContentView => {
    if (typeof part !== "object" || part === null || !("type" in part)) {
      throw new TypeError("Tool content item has no type");
    }
    const type = part.type;
    const text = "text" in part ? part.text : undefined;
    if (typeof type !== "string" || (text !== undefined && typeof text !== "string")) {
      throw new TypeError("Tool content item has an invalid shape");
    }
    return { type, text };
  });
  return { content, isError: "isError" in value && value.isError === true };
}

function textContaining(expected: string): unknown {
  return expect.stringContaining(expected);
}

function notTextContaining(expected: string): unknown {
  return expect.not.stringContaining(expected);
}

function objectWith(expected: Readonly<Record<string, unknown>>): unknown {
  return expect.objectContaining(expected);
}

function arrayWith(expected: readonly unknown[]): unknown {
  return expect.arrayContaining(expected);
}

function textMatching(expected: RegExp): unknown {
  return expect.stringMatching(expected);
}

class DisabledProvider extends Provider {
  static readonly key = "blockscout";

  override get capabilities() {
    return {
      balances: false,
      txHistory: false,
      txDetail: false,
      utxos: false,
      contractInfo: false,
      tokenBalances: false,
      tokenTransfers: false,
      gasData: false,
      blockInfo: false,
    };
  }

  override async getBalance(): Promise<never> {
    throw new Error("capability gate bypassed");
  }

  override async getTxHistory(): Promise<never> {
    throw new Error("capability gate bypassed");
  }

  override async getBlockInfo() {
    return {
      number: 1,
      hash: "0x1",
      parentHash: "0x0",
      timestamp: "2026-08-15T00:00:00.000Z",
      miner: "0x0",
      gasUsed: "0",
      gasLimit: "0",
      txCount: 0,
    };
  }
}

class ContractProvider extends DisabledProvider {
  override get capabilities() {
    return {
      balances: false,
      txHistory: false,
      txDetail: false,
      utxos: false,
      contractInfo: true,
      tokenBalances: false,
      tokenTransfers: false,
      gasData: false,
      blockInfo: false,
    };
  }

  override async getContractInfo(address: string): Promise<ContractInfo> {
    return {
      address,
      isVerified: true,
      abi: '[{"type":"fallback"}]',
      sourceCode: "contract Fixture {}",
    };
  }
}

const ZERO_HOLDING: TokenBalance = {
  contract: "0x0000000000000000000000000000000000000002",
  symbol: "ZERO",
  decimals: 18,
  balance: "0",
  balanceFormatted: "0",
};
const LIVE_HOLDING: TokenBalance = {
  contract: "0x0000000000000000000000000000000000000003",
  symbol: "LIVE",
  decimals: 18,
  balance: "1",
  balanceFormatted: "0.000000000000000001",
};

class TokenProvider extends DisabledProvider {
  override get capabilities() {
    return {
      balances: false,
      txHistory: false,
      txDetail: false,
      utxos: false,
      contractInfo: false,
      tokenBalances: true,
      tokenTransfers: false,
      gasData: false,
      blockInfo: false,
    };
  }

  override async getTokenBalances(
    _address: string,
    _chain?: ChainKey,
    options?: Readonly<TokenBalanceOptions>,
  ): Promise<TokenBalance[]> {
    const holdings = [ZERO_HOLDING, LIVE_HOLDING];
    return options?.nonZeroOnly ? holdings.filter((token) => token.balance !== "0") : holdings;
  }
}

/** Sixty live holdings, one past the fifty a call lists by default. */
const MANY_HOLDINGS: TokenBalance[] = Array.from({ length: 60 }, (_, index) => ({
  contract: `0x${(index + 16).toString(16).padStart(40, "0")}`,
  symbol: `T${index}`,
  decimals: 18,
  balance: "1",
  balanceFormatted: "0.000000000000000001",
}));

class BusyTokenProvider extends TokenProvider {
  override async getTokenBalances(): Promise<TokenBalance[]> {
    return MANY_HOLDINGS;
  }
}

describe("Explorers MCP server", () => {
  it("keeps the unconfirmed balance delta in MCP JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          chain_stats: { funded_txo_sum: 10000, spent_txo_sum: 2000 },
          mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 6000 },
        }),
      ),
    );
    const client = await connectTestClient();
    const result = parseToolResult(
      await client.callTool({
        name: "explorers_balance",
        arguments: { address: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh", provider: "mempool" },
      }),
    );
    expect(result.isError).toBe(false);
    const text = result.content[0]?.text;
    if (!text) throw new Error("Missing balance content");
    expect(JSON.parse(text)).toMatchObject({
      provider: "mempool",
      data: { balance: "8000", unconfirmed: "-6000" },
    });
  });

  it("lists unspent outputs with their funding block through MCP", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json([
          {
            txid: "a".repeat(64),
            vout: 1,
            value: "9007199254740993",
            status: { confirmed: true, block_height: 947_507, block_hash: "b".repeat(64) },
          },
        ]),
      ),
    );
    const client = await connectTestClient();
    const result = parseToolResult(
      await client.callTool({
        name: "explorers_utxos",
        arguments: { address: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh", chain: "bitcoin" },
      }),
    );
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content[0]?.text ?? "null")).toEqual({
      provider: "mempool",
      data: [
        {
          txid: "a".repeat(64),
          vout: 1,
          value: "9007199254740993",
          valueFormatted: "90071992.54740993",
          confirmed: true,
          blockNumber: 947_507,
          blockHash: "b".repeat(64),
        },
      ],
    });
  });

  it("reads Decred balances through the MCP transport", async () => {
    const address = "Dcur2mcGjmENx4DhNqDctW5wJCVyT3Qeqkx";
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              addrStr: address,
              balanceSat: 100000001,
              unconfirmedBalanceSat: -1,
              totalReceivedSat: 100000001,
              totalSentSat: 0,
            }),
          ),
      ),
    );
    const client = await connectTestClient();
    const result = parseToolResult(
      await client.callTool({ name: "explorers_balance", arguments: { address, chain: "dcr" } }),
    );
    expect(result.isError).toBe(false);
    const balance: unknown = JSON.parse(result.content[0]?.text ?? "null");
    expect(balance).toMatchObject({
      provider: "dcrdata",
      data: {
        chain: "decred",
        balance: "100000001",
        balanceFormatted: "1.00000001",
        unconfirmed: "-1",
        symbol: "DCR",
      },
    });
  });

  it("routes Decred history, transaction details and blocks through MCP", async () => {
    const address = "Dcur2mcGjmENx4DhNqDctW5wJCVyT3Qeqkx";
    const hash = "4b064b5a6255ed94bb9c4347e370c5ad034db4d0550e5bd6775cbed65015ebe3";
    const tx = { txid: hash, blockheight: 1000, confirmations: 1, vin: [], vout: [] };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = new URL(String(input)).pathname;
        const body = path.includes("/addrs/")
          ? { totalItems: 1, from: 0, to: 1, items: [tx] }
          : path.includes("/block/")
            ? [{ height: 1000, hash, previousblockhash: hash, time: 1, tx: [hash] }]
            : tx;
        return new Response(JSON.stringify(body));
      }),
    );
    const client = await connectTestClient();
    for (const [name, args, data] of [
      ["explorers_tx_history", { address, chain: "dcr", limit: 1 }, [{ hash }]],
      ["explorers_tx_detail", { hash, chain: "dcr" }, { hash, status: "success" }],
      ["explorers_block", { blockNumber: 1000, chain: "dcr" }, { number: 1000, txCount: 1 }],
    ] as const) {
      const result = parseToolResult(await client.callTool({ name, arguments: args }));
      expect(result.isError).toBe(false);
      const payload: unknown = JSON.parse(result.content[0]?.text ?? "null");
      expect(payload).toMatchObject({ provider: "dcrdata", data });
    }
  });

  it("reads Stellar balances and trustlines through the MCP transport", async () => {
    const address = "GAHK7EEG2WWHVKDNT4CEQFZGKF2LGDSW2IVM4S5DP42RBW3K6BTODB4A";
    const issuer = "GDM4RQUQQUVSKQA7S6EM7XBZP3FCGH4Q7CL6TABQ7B2BEJ5ERARM2M5M";
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              id: address,
              balances: [
                {
                  balance: "1234.5000001",
                  asset_type: "credit_alphanum4",
                  asset_code: "VELO",
                  asset_issuer: issuer,
                },
                { balance: "12.8193804", asset_type: "native" },
              ],
            }),
          ),
      ),
    );
    const client = await connectTestClient();
    const balance = parseToolResult(
      await client.callTool({ name: "explorers_balance", arguments: { address, chain: "xlm" } }),
    );
    expect(balance.isError).toBe(false);
    expect(JSON.parse(balance.content[0]?.text ?? "null")).toMatchObject({
      provider: "horizon",
      data: {
        chain: "stellar",
        balance: "128193804",
        balanceFormatted: "12.8193804",
        symbol: "XLM",
      },
    });
    const tokens = parseToolResult(
      await client.callTool({ name: "explorers_tokens", arguments: { address, chain: "stellar" } }),
    );
    expect(tokens.isError).toBe(false);
    expect(JSON.parse(tokens.content[0]?.text ?? "null")).toMatchObject({
      provider: "horizon",
      data: [{ contract: `VELO:${issuer}`, symbol: "VELO", decimals: 7, balance: "12345000001" }],
    });
  });

  it("sends the provider's transaction record only when raw is requested", async () => {
    const address = "Dcur2mcGjmENx4DhNqDctW5wJCVyT3Qeqkx";
    const hash = "4b064b5a6255ed94bb9c4347e370c5ad034db4d0550e5bd6775cbed65015ebe3";
    const tx = { txid: hash, blockheight: 1000, confirmations: 1, vin: [], vout: [] };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = new URL(String(input)).pathname;
        const body = path.includes("/addrs/") ? { totalItems: 1, from: 0, to: 1, items: [tx] } : tx;
        return new Response(JSON.stringify(body));
      }),
    );
    const client = await connectTestClient();
    const readData = async (
      name: string,
      args: Readonly<Record<string, unknown>>,
    ): Promise<unknown> => {
      const result = parseToolResult(await client.callTool({ name, arguments: args }));
      expect(result.isError).toBe(false);
      const payload = JSON.parse(result.content[0]?.text ?? "null") as { data: unknown };
      return payload.data;
    };

    const history = await readData("explorers_tx_history", { address, chain: "dcr", limit: 1 });
    expect(history).toEqual([objectWith({ hash, status: "success" })]);
    if (!isUnknownArray(history)) throw new TypeError("History is not an array");
    expect(history[0]).not.toHaveProperty("raw");
    const detail = await readData("explorers_tx_detail", { hash, chain: "dcr" });
    expect(detail).toEqual(objectWith({ hash }));
    expect(detail).not.toHaveProperty("raw");

    expect(
      await readData("explorers_tx_history", { address, chain: "dcr", limit: 1, raw: true }),
    ).toEqual([objectWith({ hash, raw: objectWith({ txid: hash }) })]);
    expect(await readData("explorers_tx_detail", { hash, chain: "dcr", raw: true })).toEqual(
      objectWith({ hash, raw: objectWith({ txid: hash }) }),
    );
  });

  it("sends a contract's ABI and source only when each is requested", async () => {
    const address = "0x0000000000000000000000000000000000000001";
    register(ContractProvider, { chains: ["ethereum"] });
    const client = await connectTestClient();
    const readContract = async (args: Readonly<Record<string, unknown>>): Promise<unknown> => {
      const result = parseToolResult(
        await client.callTool({
          name: "explorers_contract",
          arguments: { address, chain: "ethereum", provider: ContractProvider.key, ...args },
        }),
      );
      expect(result.isError).toBe(false);
      const payload = JSON.parse(result.content[0]?.text ?? "null") as { data: unknown };
      return payload.data;
    };

    expect(await readContract({})).toEqual({ address, isVerified: true });
    expect(await readContract({ abi: true })).toEqual({
      address,
      isVerified: true,
      abi: '[{"type":"fallback"}]',
    });
    expect(await readContract({ sourceCode: true })).toEqual({
      address,
      isVerified: true,
      sourceCode: "contract Fixture {}",
    });
    expect(await readContract({ abi: true, sourceCode: true })).toEqual({
      address,
      isVerified: true,
      abi: '[{"type":"fallback"}]',
      sourceCode: "contract Fixture {}",
    });
  });

  it("drops zero token balances unless the MCP call asks to keep them", async () => {
    const address = "0x0000000000000000000000000000000000000001";
    register(TokenProvider, { chains: ["ethereum"] });
    const client = await connectTestClient();
    const readTokens = async (args: Readonly<Record<string, unknown>>): Promise<unknown> => {
      const result = parseToolResult(
        await client.callTool({
          name: "explorers_tokens",
          arguments: { address, chain: "ethereum", provider: TokenProvider.key, ...args },
        }),
      );
      expect(result.isError).toBe(false);
      const payload = JSON.parse(result.content[0]?.text ?? "null") as { data: unknown };
      return payload.data;
    };

    expect(await readTokens({})).toEqual([LIVE_HOLDING]);
    expect(await readTokens({ nonZeroOnly: true })).toEqual([LIVE_HOLDING]);
    expect(await readTokens({ nonZeroOnly: false })).toEqual([ZERO_HOLDING, LIVE_HOLDING]);
  });

  it("lists fifty holdings unless limit says otherwise and counts every one", async () => {
    const address = "0x0000000000000000000000000000000000000001";
    register(BusyTokenProvider, { chains: ["ethereum"] });
    const client = await connectTestClient();
    const readTokens = async (args: Readonly<Record<string, unknown>>) => {
      const result = parseToolResult(
        await client.callTool({
          name: "explorers_tokens",
          arguments: { address, chain: "ethereum", provider: BusyTokenProvider.key, ...args },
        }),
      );
      if (result.isError) return result.content[0]?.text;
      return JSON.parse(result.content[0]?.text ?? "null") as {
        total: number;
        data: TokenBalance[];
      };
    };

    expect(await readTokens({})).toEqual({
      provider: BusyTokenProvider.key,
      total: 60,
      data: MANY_HOLDINGS.slice(0, 50),
    });
    expect(await readTokens({ limit: 2 })).toMatchObject({
      total: 60,
      data: MANY_HOLDINGS.slice(0, 2),
    });
    expect(await readTokens({ limit: 100 })).toMatchObject({ total: 60, data: MANY_HOLDINGS });
    expect(await readTokens({ limit: 0 })).toMatch(/limit/);
    expect(await readTokens({ limit: 101 })).toMatch(/limit/);
    expect(await readTokens({ limit: 1.5 })).toMatch(/limit/);
  });

  it("discovers every explorer tool and executes provider discovery", async () => {
    const client = await connectTestClient();

    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual([
      "explorers_providers",
      "explorers_balance",
      "explorers_tx_history",
      "explorers_tx_detail",
      "explorers_utxos",
      "explorers_contract",
      "explorers_tokens",
      "explorers_token_transfers",
      "explorers_gas",
      "explorers_block",
    ]);

    vi.stubEnv("ETHERSCAN_API_KEY", "");
    const response = parseToolResult(
      await client.callTool({ name: "explorers_providers", arguments: {} }),
    );
    expect(response.isError).not.toBe(true);
    const catalog: unknown = JSON.parse(response.content[0]?.text ?? "null");
    expect(catalog).toEqual(
      builtins.map((entry) => objectWith({ name: entry.key, chains: entry.chains })),
    );
    expect(catalog).toContainEqual({
      name: "etherscan",
      chains: arrayWith(["ethereum", "bsc"]),
      defaultUrl: "https://api.etherscan.io/v2/api",
      capabilities: objectWith({ balances: true, contractInfo: true }),
    });
    expect(catalog).toContainEqual({
      name: "aptos",
      chains: ["aptos"],
      capabilities: objectWith({ balances: false, blockInfo: false }),
    });
  });

  it("returns an MCP tool error for an unsupported provider operation", async () => {
    const client = await connectTestClient();

    const response = parseToolResult(
      await client.callTool({
        name: "explorers_block",
        arguments: { blockNumber: 1, chain: "aptos", provider: "aptos" },
      }),
    );
    expect(response.isError).toBe(true);
    expect(response.content).toEqual([
      {
        type: "text",
        text: textContaining('Operation "getBlockInfo" not supported by aptos'),
      },
    ]);
  });

  it.each(["", "   "])(
    "rejects an empty-like provider instead of selecting a default",
    async (provider) => {
      const client = await connectTestClient();

      const response = parseToolResult(
        await client.callTool({
          name: "explorers_block",
          arguments: { blockNumber: 1, chain: "bitcoin", provider },
        }),
      );
      expect(response.isError).toBe(true);
      expect(response.content).toEqual([
        {
          type: "text",
          text: notTextContaining("blockscout"),
        },
      ]);
    },
  );

  it("includes the selected provider and balance snapshot context", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-08-28T12:34:56.789Z");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(JSON.stringify({ coin_balance: "1" }), {
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const client = await connectTestClient();

    const response = parseToolResult(
      await client.callTool({
        name: "explorers_balance",
        arguments: {
          address: "0x0000000000000000000000000000000000000001",
          provider: "blockscout",
        },
      }),
    );
    expect(response.isError).not.toBe(true);
    expect(response.content).toEqual([
      {
        type: "text",
        text: textMatching(
          /"provider": "blockscout"[\s\S]*"balance": "1"[\s\S]*"fetchedAt": "2026-08-28T12:34:56.789Z"[\s\S]*"blockNumber": null[\s\S]*"blockHash": null/,
        ),
      },
    ]);
  });

  it("falls past an automatically selected provider's rate limit", async () => {
    vi.stubEnv("ETHERSCAN_API_KEY", "configured");
    vi.stubEnv("BLOCKCHAIR_API_KEY", "");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const payload = url.includes("etherscan.io")
          ? { status: "0", message: "NOTOK", result: "Max rate limit reached" }
          : { coin_balance: "1" };
        return new Response(JSON.stringify(payload), {
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const client = await connectTestClient();

    const response = parseToolResult(
      await client.callTool({
        name: "explorers_balance",
        arguments: {
          address: "0x0000000000000000000000000000000000000001",
          chain: "ethereum",
        },
      }),
    );

    expect(response.isError).not.toBe(true);
    expect(response.content).toEqual([
      {
        type: "text",
        text: textMatching(/"provider": "blockscout"[\s\S]*"balance": "1"/),
      },
    ]);
  }, 10_000);

  it("returns one balance per address for a batch request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(JSON.stringify({ coin_balance: "1" }), {
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const client = await connectTestClient();

    const response = parseToolResult(
      await client.callTool({
        name: "explorers_balance",
        arguments: {
          address: [
            "0x0000000000000000000000000000000000000001",
            "0x0000000000000000000000000000000000000002",
          ],
          provider: "blockscout",
        },
      }),
    );
    expect(response.isError).not.toBe(true);
    const [content] = response.content as Array<{ type: string; text: string }>;
    const payload = JSON.parse(content!.text) as {
      provider: string;
      data: Array<{ address: string }>;
    };
    expect(payload.provider).toBe("blockscout");
    expect(payload.data.map((balance) => balance.address)).toEqual([
      "0x0000000000000000000000000000000000000001",
      "0x0000000000000000000000000000000000000002",
    ]);
  });

  it("rejects a whitespace-only address before any provider call", async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error("network must not be reached");
    });
    vi.stubGlobal("fetch", fetchSpy);
    const client = await connectTestClient();

    for (const address of ["   ", ["   "]]) {
      const response = parseToolResult(
        await client.callTool({
          name: "explorers_balance",
          arguments: { address, provider: "blockscout" },
        }),
      );
      expect(response.isError).toBe(true);
      expect(response.content).toEqual([
        { type: "text", text: textContaining("Invalid arguments") },
      ]);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reads a Bitcoin address on Bitcoin when no chain is given", async () => {
    const fetchSpy = vi.fn(async (_input: string | URL | Request) =>
      Response.json({
        chain_stats: { funded_txo_sum: 5000, spent_txo_sum: 0 },
        mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const client = await connectTestClient();

    const result = parseToolResult(
      await client.callTool({
        name: "explorers_balance",
        arguments: { address: "1AndrewYangForPresident2o2ozm6Pzd" },
      }),
    );
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content[0]?.text ?? "")).toMatchObject({
      provider: "mempool",
      data: { chain: "bitcoin", balance: "5000" },
    });
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain("mempool.space");
  });

  it("rejects an address from another chain family before any provider call", async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error("network must not be reached");
    });
    vi.stubGlobal("fetch", fetchSpy);
    const client = await connectTestClient();

    const response = parseToolResult(
      await client.callTool({
        name: "explorers_balance",
        arguments: { address: "1AndrewYangForPresident2o2ozm6Pzd", chain: "ethereum" },
      }),
    );
    expect(response.isError).toBe(true);
    expect(response.content).toEqual([
      {
        type: "text",
        text: textContaining(
          "Address 1AndrewYangForPresident2o2ozm6Pzd is not valid on ethereum; its format matches bitcoin",
        ),
      },
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects an empty address list", async () => {
    const client = await connectTestClient();

    const response = parseToolResult(
      await client.callTool({
        name: "explorers_balance",
        arguments: { address: [], provider: "blockscout" },
      }),
    );
    expect(response.isError).toBe(true);
  });

  it.each([
    {
      tool: "explorers_balance",
      operation: "getBalance",
      arguments: {
        address: "0x0000000000000000000000000000000000000001",
        provider: DisabledProvider.key,
      },
    },
    {
      tool: "explorers_tx_history",
      operation: "getTxHistory",
      arguments: {
        address: "0x0000000000000000000000000000000000000001",
        provider: DisabledProvider.key,
      },
    },
    {
      tool: "explorers_utxos",
      operation: "getUtxos",
      arguments: {
        address: "0x0000000000000000000000000000000000000001",
        provider: DisabledProvider.key,
      },
    },
  ])("honors the disabled capability for $tool", async ({ tool, operation, arguments: args }) => {
    register(DisabledProvider, { chains: ["ethereum"] });
    const client = await connectTestClient();

    const response = parseToolResult(await client.callTool({ name: tool, arguments: args }));
    expect(response.isError).toBe(true);
    expect(response.content).toEqual([
      {
        type: "text",
        text: textContaining(`Operation "${operation}" not supported by blockscout`),
      },
    ]);
  });

  it("honors a disabled optional capability despite a method being present", async () => {
    register(DisabledProvider, { chains: ["ethereum"] });
    const client = await connectTestClient();

    const response = parseToolResult(
      await client.callTool({
        name: "explorers_block",
        arguments: { blockNumber: 1, provider: DisabledProvider.key },
      }),
    );
    expect(response.isError).toBe(true);
    expect(response.content).toEqual([
      {
        type: "text",
        text: textContaining('Operation "getBlockInfo" not supported by blockscout'),
      },
    ]);
  });

  it("resolves ENS names before contract lookup", async () => {
    const resolvedAddress = "0x0000000000000000000000000000000000000001";
    register(ContractProvider, { chains: ["ethereum"] });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(JSON.stringify({ address: resolvedAddress }), {
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const client = await connectTestClient();

    const response = parseToolResult(
      await client.callTool({
        name: "explorers_contract",
        arguments: { address: "vitalik.eth", chain: "ethereum", provider: ContractProvider.key },
      }),
    );
    expect(response.isError).not.toBe(true);
    expect(response.content).toEqual([
      {
        type: "text",
        text: textContaining(`"address": "${resolvedAddress}"`),
      },
    ]);
  });
});
