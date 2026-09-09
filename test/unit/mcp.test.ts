import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Provider } from "../../src/core/provider.js";
import type { ProviderConstructor } from "../../src/core/provider.js";
import { create, register } from "../../src/core/registry.js";
import { builtins } from "../../src/providers/index.js";
import type { ContractInfo } from "../../src/core/types.js";
import { createMcpServer } from "../../src/mcp.js";

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
      contractInfo: true,
      tokenBalances: false,
      tokenTransfers: false,
      gasData: false,
      blockInfo: false,
    };
  }

  override async getContractInfo(address: string): Promise<ContractInfo> {
    return { address, isVerified: true };
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
      data: { chain: "decred", balance: "100000000", balanceFormatted: "1", symbol: "DCR" },
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

  it("discovers every explorer tool and executes provider discovery", async () => {
    const client = await connectTestClient();

    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual([
      "explorers_providers",
      "explorers_balance",
      "explorers_tx_history",
      "explorers_tx_detail",
      "explorers_contract",
      "explorers_tokens",
      "explorers_token_transfers",
      "explorers_gas",
      "explorers_block",
    ]);

    const response = parseToolResult(
      await client.callTool({ name: "explorers_providers", arguments: {} }),
    );
    expect(response.isError).not.toBe(true);
    expect(response.content).toEqual([
      {
        type: "text",
        text: textContaining('"name": "blockscout"'),
      },
    ]);
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
  });

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
      arguments: { address: "0x1", provider: DisabledProvider.key },
    },
    {
      tool: "explorers_tx_history",
      operation: "getTxHistory",
      arguments: { address: "0x1", provider: DisabledProvider.key },
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
