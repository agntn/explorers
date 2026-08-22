import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Provider } from "../../src/core/provider.js";
import type { ProviderConstructor } from "../../src/core/provider.js";
import { create, getDefaultURL, register } from "../../src/core/registry.js";
import type { ContractInfo } from "../../src/core/types.js";
import { createMcpServer } from "../../src/mcp.js";

const openConnections: Array<{ close(): Promise<void> }> = [];

// SAFETY: create() instantiates the ProviderConstructor registered for this key.
const blockscoutConstructor = create("blockscout").constructor as ProviderConstructor;
const blockscoutDefaultURL = getDefaultURL("blockscout");

afterEach(async () => {
  register(blockscoutConstructor, blockscoutDefaultURL);
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

    const response = await client.callTool({ name: "explorers_providers", arguments: {} });
    expect(response.isError).not.toBe(true);
    expect(response.content).toEqual([
      {
        type: "text",
        text: expect.stringContaining('"name": "blockscout"'),
      },
    ]);
  });

  it("returns an MCP tool error for an unsupported provider operation", async () => {
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "explorers_block",
      arguments: { blockNumber: 1, chain: "aptos", provider: "aptos" },
    });
    expect(response.isError).toBe(true);
    expect(response.content).toEqual([
      {
        type: "text",
        text: expect.stringContaining('Operation "getBlockInfo" not supported by aptos'),
      },
    ]);
  });

  it.each(["", "   "])(
    "rejects an empty-like provider instead of selecting a default",
    async (provider) => {
      const client = await connectTestClient();

      const response = await client.callTool({
        name: "explorers_block",
        arguments: { blockNumber: 1, chain: "bitcoin", provider },
      });
      expect(response.isError).toBe(true);
      expect(response.content).toEqual([
        {
          type: "text",
          text: expect.not.stringContaining("blockscout"),
        },
      ]);
    },
  );

  it("includes the selected provider in operation results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(JSON.stringify({ coin_balance: "1" }), {
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "explorers_balance",
      arguments: {
        address: "0x0000000000000000000000000000000000000001",
        provider: "blockscout",
      },
    });
    expect(response.isError).not.toBe(true);
    expect(response.content).toEqual([
      {
        type: "text",
        text: expect.stringMatching(/"provider": "blockscout"[\s\S]*"balance": "1"/),
      },
    ]);
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
    register(DisabledProvider);
    const client = await connectTestClient();

    const response = await client.callTool({ name: tool, arguments: args });
    expect(response.isError).toBe(true);
    expect(response.content).toEqual([
      {
        type: "text",
        text: expect.stringContaining(`Operation "${operation}" not supported by blockscout`),
      },
    ]);
  });

  it("honors a disabled optional capability despite a method being present", async () => {
    register(DisabledProvider);
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "explorers_block",
      arguments: { blockNumber: 1, provider: DisabledProvider.key },
    });
    expect(response.isError).toBe(true);
    expect(response.content).toEqual([
      {
        type: "text",
        text: expect.stringContaining('Operation "getBlockInfo" not supported by blockscout'),
      },
    ]);
  });

  it("resolves ENS names before contract lookup", async () => {
    const resolvedAddress = "0x0000000000000000000000000000000000000001";
    register(ContractProvider);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(JSON.stringify({ address: resolvedAddress }), {
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "explorers_contract",
      arguments: { address: "vitalik.eth", chain: "eth", provider: ContractProvider.key },
    });
    expect(response.isError).not.toBe(true);
    expect(response.content).toEqual([
      {
        type: "text",
        text: expect.stringContaining(`"address": "${resolvedAddress}"`),
      },
    ]);
  });
});
