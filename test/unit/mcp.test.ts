import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { Provider } from "../../src/core/provider.js";
import type { Balance } from "../../src/core/types.js";
import { register } from "../../src/core/registry.js";
import { createMcpServer } from "../../src/mcp.js";

const openConnections: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
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

class DisabledBlockProvider extends Provider {
  static readonly key = "disabled-block";

  override get capabilities() {
    return {
      balances: true,
      txHistory: true,
      txDetail: false,
      contractInfo: false,
      tokenBalances: false,
      gasData: false,
      blockInfo: false,
    };
  }

  override async getBalance(): Promise<Balance> {
    return {
      address: "0x1",
      chain: "eth",
      balance: "1",
      balanceFormatted: "0.000000000000000001",
      symbol: "ETH",
    };
  }

  override async getTxHistory(): Promise<never> {
    throw new Error("not used");
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

  it("rejects an explicitly empty provider instead of selecting a default", async () => {
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "explorers_block",
      arguments: { blockNumber: 1, chain: "bitcoin", provider: "" },
    });
    expect(response.isError).toBe(true);
    expect(response.content).toEqual([
      {
        type: "text",
        text: expect.not.stringContaining("blockscout"),
      },
    ]);
  });

  it("includes the selected provider in operation results", async () => {
    register(DisabledBlockProvider);
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "explorers_balance",
      arguments: { address: "0x1", provider: DisabledBlockProvider.key },
    });
    expect(response.isError).not.toBe(true);
    expect(response.content).toEqual([
      {
        type: "text",
        text: expect.stringMatching(/"provider": "disabled-block"[\s\S]*"balance": "1"/),
      },
    ]);
  });

  it("honors a provider capability disabled despite a method being present", async () => {
    register(DisabledBlockProvider);
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "explorers_block",
      arguments: { blockNumber: 1, provider: DisabledBlockProvider.key },
    });
    expect(response.isError).toBe(true);
    expect(response.content).toEqual([
      {
        type: "text",
        text: expect.stringContaining('Operation "getBlockInfo" not supported by disabled-block'),
      },
    ]);
  });
});
