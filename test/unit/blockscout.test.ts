/** Blockscout provider contract tests with deterministic API fixtures. */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "../../src/core/registry.js";

const VITALIK = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

function stubJSON(body: unknown, status = 200) {
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function stubHangingFetch() {
  const fetch = vi.fn(
    (_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
          once: true,
        });
      }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("Unexpected network request in unit test");
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("blockscout provider", () => {
  let provider: Awaited<ReturnType<typeof create>>;

  beforeAll(async () => {
    provider = await create("blockscout");
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

  it("allows complete balance responses 60 seconds by default", async () => {
    vi.useFakeTimers();
    stubHangingFetch();

    let settled = false;
    const request = provider.getTokenBalances!(VITALIK, "ethereum").finally(() => (settled = true));
    const rejection = expect(request).rejects.toMatchObject({ provider: "blockscout" });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(30_000);
    await rejection;
  });

  it("keeps the shared 15-second timeout for other reads", async () => {
    vi.useFakeTimers();
    stubHangingFetch();

    const rejection = expect(provider.getBalance(VITALIK, "ethereum")).rejects.toMatchObject({
      provider: "blockscout",
    });
    await vi.advanceTimersByTimeAsync(15_000);

    await rejection;
  });

  it("honors an explicit timeout for complete balance responses", async () => {
    vi.useFakeTimers();
    stubHangingFetch();
    const configured = await create("blockscout", { timeout: 25 });

    const rejection = expect(
      configured.getTokenBalances!(VITALIK, "ethereum"),
    ).rejects.toMatchObject({ provider: "blockscout" });
    await vi.advanceTimersByTimeAsync(25);

    await rejection;
  });

  it("dates an address balance response without inventing chain position", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-08-28T12:34:56.789Z");
    stubJSON({ coin_balance: "1250000000000000000" });

    await expect(provider.getBalance(VITALIK, "ethereum")).resolves.toEqual({
      address: VITALIK,
      chain: "ethereum",
      balance: "1250000000000000000",
      balanceFormatted: "1.25",
      symbol: "ETH",
      fetchedAt: "2026-08-28T12:34:56.789Z",
      blockNumber: null,
      blockHash: null,
    });
  });

  it("maps a null address balance to zero", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-08-28T12:34:56.789Z");
    stubJSON({ coin_balance: null });

    await expect(provider.getBalance(VITALIK, "ethereum")).resolves.toEqual({
      address: VITALIK,
      chain: "ethereum",
      balance: "0",
      balanceFormatted: "0",
      symbol: "ETH",
      fetchedAt: "2026-08-28T12:34:56.789Z",
      blockNumber: null,
      blockHash: null,
    });
  });

  it("maps an address transaction response", async () => {
    stubJSON({
      items: [
        {
          hash: `0x${"1".repeat(64)}`,
          block_number: 123,
          timestamp: "2026-08-22T18:24:59.000000Z",
          from: { hash: "0x1111111111111111111111111111111111111111" },
          to: { hash: VITALIK },
          value: "1000000000000000000",
          gas_used: "21000",
          gas_price: "2",
          status: "ok",
          transaction_types: [],
        },
      ],
      next_page_params: null,
    });

    await expect(provider.getTxHistory(VITALIK, "ethereum", { limit: 3 })).resolves.toMatchObject([
      {
        hash: `0x${"1".repeat(64)}`,
        blockNumber: 123,
        from: "0x1111111111111111111111111111111111111111",
        to: VITALIK,
        value: "1000000000000000000",
        valueFormatted: "1",
        status: "success",
      },
    ]);
  });

  it("marks contract creation as a contract interaction", async () => {
    const hash = "0xb95343413e459a0f97461812111254163ae53467855c0d73e0f1e7c5b8442fa3";
    stubJSON({
      hash,
      block_number: 4_719_568,
      timestamp: "2017-12-12T11:17:35.000000Z",
      from: { hash: "0x4F26FfBe5F04ED43630fdC30A87638d53D0b0876" },
      to: null,
      value: "0",
      gas_used: "966549",
      gas_price: "21000000000",
      status: "ok",
      transaction_types: ["contract_creation", "token_creation"],
    });

    await expect(provider.getTxDetail!(hash, "ethereum")).resolves.toMatchObject({
      to: null,
      isContractInteraction: true,
    });
  });

  it("walks transaction pages until the requested limit is reached", async () => {
    const transaction = (block: number) => ({
      hash: `0x${block.toString(16).padStart(64, "0")}`,
      block_number: block,
      timestamp: "2026-08-22T18:24:59.000000Z",
      from: { hash: "0x1111111111111111111111111111111111111111" },
      to: { hash: VITALIK },
      value: "0",
      gas_used: "21000",
      gas_price: "1",
      status: "ok",
      transaction_types: [],
    });
    const page = (
      items: readonly unknown[],
      next: Readonly<Record<string, string | number> | null>,
    ): Response =>
      new Response(JSON.stringify({ items, next_page_params: next }), {
        headers: { "Content-Type": "application/json" },
      });
    const firstPage = Array.from({ length: 50 }, (_, index) => transaction(100 - index));
    const cursorHash = transaction(51).hash;
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        page(firstPage, {
          block_number: 51,
          fee: "21000",
          hash: cursorHash,
          index: 1,
          inserted_at: "2026-08-22T18:24:59.000000Z",
          items_count: 50,
          value: "0",
        }),
      )
      .mockResolvedValueOnce(page([transaction(50)], null));
    vi.stubGlobal("fetch", fetch);

    const transactions = await provider.getTxHistory(VITALIK, "ethereum", { limit: 51 });

    expect(transactions).toHaveLength(51);
    expect(transactions.at(-1)?.blockNumber).toBe(50);
    expect(fetch).toHaveBeenCalledTimes(2);
    const second = new URL(String(fetch.mock.calls[1]?.[0]));
    expect(Object.fromEntries(second.searchParams)).toEqual({
      block_number: "51",
      fee: "21000",
      hash: cursorHash,
      index: "1",
      inserted_at: "2026-08-22T18:24:59.000000Z",
      items_count: "50",
      value: "0",
    });
  });

  it("maps verified contract information", async () => {
    stubJSON({
      is_verified: true,
      name: "FiatTokenV2_2",
      compiler_version: "v0.8.20",
      abi: [{ type: "function", name: "transfer" }],
    });

    await expect(provider.getContractInfo(USDC_BASE, "base")).resolves.toMatchObject({
      address: USDC_BASE,
      isVerified: true,
      name: "FiatTokenV2_2",
      compilerVersion: "v0.8.20",
      isToken: true,
    });
  });

  it("maps current gas prices", async () => {
    stubJSON({ gas_prices: { slow: "0.1", average: "0.21", fast: "1.17" } });

    await expect(provider.getGasData!("ethereum")).resolves.toEqual({
      chain: "ethereum",
      unit: "gwei",
      safeGasPrice: "0.1",
      proposedGasPrice: "0.21",
      fastGasPrice: "1.17",
    });
  });

  it("uses Blockscout's complete balance endpoint for wallets with more than 50 entries", async () => {
    const tokenBalance = (contract: string, symbol: string) => ({
      token: {
        address_hash: contract,
        symbol,
        name: symbol,
        decimals: "6",
        type: "ERC-20",
      },
      value: "1250000",
    });
    const extraBalances = Array.from({ length: 50 }, (_, index) =>
      tokenBalance(`0x${(index + 1).toString(16).padStart(40, "0")}`, `TOKEN${index + 1}`),
    );
    const fetch = stubJSON([
      tokenBalance(USDC_BASE, "USDC"),
      ...extraBalances,
      {
        token: {
          address_hash: "0x9999999999999999999999999999999999999999",
          symbol: null,
          name: null,
          decimals: null,
          type: "ERC-20",
        },
        value: "7",
      },
      {
        token: {
          address_hash: "0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85",
          symbol: "ENS",
          name: "Ethereum Name Service",
          decimals: null,
          type: "ERC-721",
        },
        value: "473",
      },
      { token: null, value: "0" },
    ]);

    const balances = await provider.getTokenBalances!(VITALIK, "ethereum");

    expect(balances).toHaveLength(52);
    expect(balances[0]).toEqual({
      contract: USDC_BASE,
      symbol: "USDC",
      name: "USDC",
      decimals: 6,
      balance: "1250000",
      balanceFormatted: "1.25",
    });
    expect(balances[50]?.contract).toBe("0x0000000000000000000000000000000000000032");
    expect(balances.at(-1)).toEqual({
      contract: "0x9999999999999999999999999999999999999999",
      symbol: "",
      name: undefined,
      decimals: 0,
      balance: "7",
      balanceFormatted: "7",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetch.mock.calls[0]?.[0]));
    expect(url.pathname).toBe(`/api/v2/addresses/${VITALIK}/token-balances`);
    expect(url.search).toBe("");
  });

  it("normalizes numeric gas prices to domain strings", async () => {
    stubJSON({ gas_prices: { slow: 0.1, average: 0.21, fast: 1.17 } });

    await expect(provider.getGasData!("ethereum")).resolves.toEqual({
      chain: "ethereum",
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
        "ethereum",
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

    const transfers = await provider.getTokenTransfers!(VITALIK, "ethereum", { token: USDC_BASE });

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

  it("walks keyset pages until the requested limit is reached", async () => {
    const transfer = (block: number) => ({
      token: {
        address_hash: USDC_BASE,
        symbol: "USDC",
        name: "USD Coin",
        decimals: "6",
        type: "ERC-20",
      },
      from: { hash: "0x1111111111111111111111111111111111111111" },
      to: { hash: VITALIK },
      total: { value: "1000000" },
      transaction_hash: "0x3333333333333333333333333333333333333333333333333333333333333333",
      block_number: block,
      timestamp: "2026-08-22T18:24:59.000000Z",
    });
    const page = (items: readonly unknown[], next: Readonly<Record<string, number> | null>) =>
      new Response(JSON.stringify({ items, next_page_params: next }), {
        headers: { "Content-Type": "application/json" },
      });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        page([transfer(12), transfer(11)], { block_number: 11, index: 1, items_count: 50 }),
      )
      .mockResolvedValueOnce(page([transfer(10)], null));
    vi.stubGlobal("fetch", fetch);

    const transfers = await provider.getTokenTransfers!(VITALIK, "ethereum", { limit: 3 });

    expect(transfers.map((t) => t.blockNumber)).toEqual([12, 11, 10]);
    expect(fetch).toHaveBeenCalledTimes(2);
    const second = new URL(String(fetch.mock.calls[1]?.[0]));
    expect(second.searchParams.get("block_number")).toBe("11");
    expect(second.searchParams.get("index")).toBe("1");
    expect(second.searchParams.get("type")).toBe("ERC-20");
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
      "ethereum",
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

    await expect(provider.getBlockInfo!(123, "ethereum")).resolves.toMatchObject({
      number: 123,
      hash: "0xblock",
      txCount: 7,
    });
  });

  it("rejects a Blockscout invalid-address response", async () => {
    stubJSON({ message: "Invalid address hash" }, 400);

    await expect(provider.getBalance("not-an-address", "ethereum")).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});
