/**
 * Explorers — Blockscout integration tests
 *
 * Tests are live roundtrips against public Blockscout API. Expected values are derived from API
 * responses, not hand-written.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { create } from "../../src/core/registry.js";
import "../../src/providers/blockscout.js";

const VITALIK = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

function stubJSON(body: unknown) {
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("blockscout provider", () => {
  let provider: ReturnType<typeof create>;

  beforeAll(() => {
    provider = create("blockscout");
  });

  it("reports capabilities", () => {
    const caps = provider.capabilities;
    expect(caps.balances).toBe(true);
    expect(caps.txHistory).toBe(true);
    expect(caps.txDetail).toBe(true);
    expect(caps.contractInfo).toBe(true);
    expect(caps.tokenBalances).toBe(true);
    expect(caps.tokenTransfers).toBe(true);
    expect(caps.gasData).toBe(true);
    expect(caps.blockInfo).toBe(true);
  });

  it("getBalance returns valid structure for known address", async () => {
    const balance = await provider.getBalance(VITALIK, "eth");

    expect(balance.address).toBe(VITALIK);
    expect(balance.chain).toBe("eth");
    expect(balance.symbol).toBe("ETH");
    // Balance should be a valid wei string (digits only)
    expect(balance.balance).toMatch(/^\d+$/);
    // Formatted should look like a decimal number
    expect(balance.balanceFormatted).toMatch(/^\d+(\.\d+)?$/);
    // Vitalik should have > 0 ETH
    expect(Number(balance.balanceFormatted)).toBeGreaterThan(0);
  });

  it("getTxHistory returns array of transactions", async () => {
    const txs = await provider.getTxHistory(VITALIK, "eth", { limit: 3 });

    expect(Array.isArray(txs)).toBe(true);
    expect(txs.length).toBeLessThanOrEqual(3);
    expect(txs.length).toBeGreaterThan(0);

    const tx = txs[0]!;
    expect(tx.hash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(tx.from).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(typeof tx.blockNumber).toBe("number");
    expect(tx.blockNumber).toBeGreaterThan(0);
    expect(["success", "failed", "pending"]).toContain(tx.status);
  });

  it("getContractInfo returns info for known contract", async () => {
    const info = await provider.getContractInfo(USDC_BASE, "base");

    expect(info.address).toBe(USDC_BASE);
    expect(typeof info.isVerified).toBe("boolean");
    // USDC should be verified
    expect(info.isVerified).toBe(true);
    // Should have a name
    expect(info.name).toBeTruthy();
  });

  it("getGasData returns gas prices", async () => {
    const gas = await provider.getGasData!("eth");

    expect(gas.chain).toBe("eth");
    // At least one gas price field should be present
    const hasPrice = gas.safeGasPrice || gas.proposedGasPrice || gas.fastGasPrice;
    expect(hasPrice).toBeTruthy();
    // Gas price should be a valid number string
    if (gas.proposedGasPrice) {
      expect(Number(gas.proposedGasPrice)).toBeGreaterThan(0);
    }
  });

  it("maps the current token balance response envelope", async () => {
    stubJSON({
      items: [
        {
          token: {
            address_hash: USDC_BASE,
            symbol: "USDC",
            name: "USD Coin",
            decimals: "6",
            type: "ERC-20",
          },
          value: "1250000",
        },
      ],
    });

    await expect(provider.getTokenBalances!(VITALIK, "eth")).resolves.toEqual([
      {
        contract: USDC_BASE,
        symbol: "USDC",
        name: "USD Coin",
        decimals: 6,
        balance: "1250000",
        balanceFormatted: "1.25",
      },
    ]);
  });

  it("normalizes numeric gas prices to domain strings", async () => {
    stubJSON({ gas_prices: { slow: 0.1, average: 0.21, fast: 1.17 } });

    await expect(provider.getGasData!("eth")).resolves.toEqual({
      chain: "eth",
      unit: "gwei",
      safeGasPrice: "0.1",
      proposedGasPrice: "0.21",
      fastGasPrice: "1.17",
    });
  });

  it("maps a pending transaction instead of crashing on null fields", async () => {
    // Shape taken from a live /api/v2/transactions?filter=pending item:
    // status, block_number, timestamp, and gas_used are null until the tx is mined.
    stubJSON({
      hash: "0x8c31d3b73176853e0731d97c1fcef1300c234a2c4046ca6f9dfcb3a0e691b127",
      block_number: null,
      timestamp: null,
      from: { hash: "0x1111111111111111111111111111111111111111" },
      to: { hash: "0x2222222222222222222222222222222222222222" },
      value: "0",
      gas_used: null,
      gas_price: "182783318",
      status: null,
      transaction_types: ["contract_call"],
    });

    await expect(
      provider.getTxDetail!(
        "0x8c31d3b73176853e0731d97c1fcef1300c234a2c4046ca6f9dfcb3a0e691b127",
        "eth",
      ),
    ).resolves.toMatchObject({
      status: "pending",
      blockNumber: 0,
      timestamp: undefined,
      gasUsed: undefined,
      fee: undefined,
    });
  });

  it("requests ERC-20 address transfers and maps the list envelope", async () => {
    const fetch = stubJSON({
      items: [
        {
          token: {
            address_hash: USDC_BASE,
            symbol: "USDC",
            name: "USD Coin",
            decimals: "6",
            type: "ERC-20",
          },
          from: { hash: "0x1111111111111111111111111111111111111111" },
          to: { hash: VITALIK },
          total: { value: "1250000" },
          transaction_hash: "0x3333333333333333333333333333333333333333333333333333333333333333",
          block_number: 10,
          timestamp: "2026-08-22T18:24:59.000000Z",
        },
      ],
    });

    const transfers = await provider.getTokenTransfers!(VITALIK, "eth", { token: USDC_BASE });

    const url = new URL(String(fetch.mock.calls[0]?.[0]));
    expect(url.pathname).toBe(`/api/v2/addresses/${VITALIK}/token-transfers`);
    expect(url.searchParams.get("type")).toBe("ERC-20");
    expect(url.searchParams.get("token")).toBe(USDC_BASE);
    expect(transfers).toEqual([
      {
        contract: USDC_BASE,
        symbol: "USDC",
        name: "USD Coin",
        decimals: 6,
        value: "1250000",
        valueFormatted: "1.25",
        from: "0x1111111111111111111111111111111111111111",
        to: VITALIK,
        txHash: "0x3333333333333333333333333333333333333333333333333333333333333333",
        blockNumber: 10,
        timestamp: "2026-08-22T18:24:59.000000Z",
      },
    ]);
  });

  it("maps embedded token transfers and skips non-fungible items", async () => {
    // Field names taken from a live /api/v2/transactions/{hash} response: transfers
    // carry transaction_hash, and ERC-721 items have total.token_id without value.
    stubJSON({
      hash: "0x3333333333333333333333333333333333333333333333333333333333333333",
      block_number: 10,
      timestamp: "2026-08-22T18:24:59.000000Z",
      from: { hash: "0x1111111111111111111111111111111111111111" },
      to: { hash: "0x2222222222222222222222222222222222222222" },
      value: "0",
      gas_used: "21000",
      gas_price: "1",
      status: "ok",
      token_transfers: [
        {
          token: {
            address_hash: USDC_BASE,
            symbol: "USDC",
            name: "USD Coin",
            decimals: "6",
            type: "ERC-20",
          },
          from: { hash: "0x1111111111111111111111111111111111111111" },
          to: { hash: "0x2222222222222222222222222222222222222222" },
          total: { value: "1250000" },
          transaction_hash: "0x3333333333333333333333333333333333333333333333333333333333333333",
          block_number: 10,
          timestamp: "2026-08-22T18:24:59.000000Z",
        },
        {
          token: {
            address_hash: "0x4444444444444444444444444444444444444444",
            symbol: "NFT",
            name: "Some NFT",
            decimals: null,
            type: "ERC-721",
          },
          from: { hash: "0x1111111111111111111111111111111111111111" },
          to: { hash: "0x2222222222222222222222222222222222222222" },
          total: { token_id: "4565" },
          transaction_hash: "0x3333333333333333333333333333333333333333333333333333333333333333",
          block_number: 10,
          timestamp: "2026-08-22T18:24:59.000000Z",
        },
      ],
    });

    const tx = await provider.getTxDetail!(
      "0x3333333333333333333333333333333333333333333333333333333333333333",
      "eth",
    );

    expect(tx.tokenTransfers).toEqual([
      {
        contract: USDC_BASE,
        symbol: "USDC",
        name: "USD Coin",
        decimals: 6,
        value: "1250000",
        valueFormatted: "1.25",
        from: "0x1111111111111111111111111111111111111111",
        to: "0x2222222222222222222222222222222222222222",
        txHash: "0x3333333333333333333333333333333333333333333333333333333333333333",
        blockNumber: 10,
        timestamp: "2026-08-22T18:24:59.000000Z",
      },
    ]);
  });

  it("maps the current block transaction count field", async () => {
    stubJSON({
      height: 123,
      hash: "0xblock",
      parent_hash: "0xparent",
      timestamp: "2026-08-09T18:00:00.000Z",
      miner: { hash: "0xminer" },
      gas_used: "100",
      gas_limit: "200",
      transactions_count: 7,
      base_fee_per_gas: "3",
    });

    await expect(provider.getBlockInfo!(123, "eth")).resolves.toMatchObject({
      number: 123,
      hash: "0xblock",
      txCount: 7,
    });
  });

  it("getBalance throws on invalid address gracefully", async () => {
    // Blockscout returns 400 for invalid addresses
    await expect(provider.getBalance("not-an-address", "eth")).rejects.toThrow();
  });
});
