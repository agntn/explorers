import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { create } from "../../src/core/registry.ts";
import { ExplorerError, UnsupportedChainError } from "../../src/core/errors.ts";

const ADDRESS = "GAHK7EEG2WWHVKDNT4CEQFZGKF2LGDSW2IVM4S5DP42RBW3K6BTODB4A";
const SENDER = "GC7YFQUTYWEZI6CE4JSOFCM6GRPXHLZOQPKFDGYO6BFTKYQ4KWU7KQI7";
const OTHER = "GCAQSQVXUJZPDND4EUWQYRCJ64IGQ3REQK2CVSXHUQQ26GCTEMIGJDSC";
const USDC = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const KALE = "GBDVX4VELCDSQ54KQJYTNHXAHFLBCA77ZY2USQBM4CSHTTV7DME7KALE";
const HASH = "6d43a7d6b67a13f44c338f6ca7c0ec3e5d25af143af8a568d34ac4b80ad4dffe";

function transaction(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    id: HASH,
    hash: HASH,
    ledger: 64490662,
    created_at: "2026-09-18T13:44:48Z",
    source_account: SENDER,
    fee_charged: "100",
    max_fee: "10000",
    operation_count: 1,
    successful: true,
    memo_type: "text",
    memo: "hello",
    envelope_xdr: "AAAA",
    ...overrides,
  };
}

/* One payment-like operation as Horizon lists it under /payments with join=transactions. */
function operation(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    id: "276985284187893775",
    paging_token: "276985284187893775",
    transaction_successful: true,
    source_account: SENDER,
    type: "payment",
    type_i: 1,
    created_at: "2026-09-18T13:44:48Z",
    transaction_hash: HASH,
    asset_type: "native",
    from: SENDER,
    to: ADDRESS,
    amount: "0.0000001",
    transaction: transaction(),
    ...overrides,
  };
}

function page(records: readonly unknown[]) {
  return { _links: { self: { href: "" } }, _embedded: { records } };
}

interface Call {
  readonly path: string;
  readonly query: URLSearchParams;
}

/* Answers each request with the first rule whose fragment the URL contains; "" catches the rest. */
function stubRoutes(rules: ReadonlyArray<readonly [string, unknown]>) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    calls.push({ path: url.pathname, query: url.searchParams });
    const body = rules.find(([fragment]) => url.href.includes(fragment))?.[1];
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetch);
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("horizon history", () => {
  it("maps every payment-like operation to a row with the joined ledger and fee", async () => {
    const calls = stubRoutes([
      [
        "",
        page([
          operation(),
          operation({
            paging_token: "2",
            asset_type: "credit_alphanum4",
            asset_code: "USDC",
            asset_issuer: USDC,
            amount: "16.6900000",
            from: ADDRESS,
            to: OTHER,
            transaction: transaction({ operation_count: 2, fee_charged: "300" }),
          }),
          operation({
            paging_token: "3",
            type: "create_account",
            asset_type: undefined,
            from: undefined,
            to: undefined,
            amount: undefined,
            funder: SENDER,
            account: ADDRESS,
            starting_balance: "1.6000000",
          }),
          operation({
            paging_token: "4",
            type: "account_merge",
            asset_type: undefined,
            from: undefined,
            to: undefined,
            amount: undefined,
            account: OTHER,
            into: ADDRESS,
          }),
          operation({
            paging_token: "5",
            type: "invoke_host_function",
            asset_type: undefined,
            from: undefined,
            to: undefined,
            amount: undefined,
            function: "HostFunctionTypeHostFunctionTypeInvokeContract",
            asset_balance_changes: [
              {
                asset_type: "credit_alphanum4",
                asset_code: "KALE",
                asset_issuer: KALE,
                type: "mint",
                to: ADDRESS,
                amount: "0.1486651",
              },
              {
                asset_type: "native",
                type: "transfer",
                from: ADDRESS,
                to: OTHER,
                amount: "2.0000000",
              },
            ],
          }),
          operation({
            paging_token: "6",
            transaction_successful: false,
            asset_type: "credit_alphanum4",
            asset_code: "USDC",
            asset_issuer: USDC,
            amount: "1.0000000",
            transaction: transaction({ successful: false }),
          }),
        ]),
      ],
    ]);
    const provider = await create("horizon");
    const rows = await provider.getTxHistory(ADDRESS, "stellar", { limit: 6 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe(`/accounts/${ADDRESS}/payments`);
    expect(Object.fromEntries(calls[0]?.query ?? [])).toEqual({
      order: "desc",
      limit: "6",
      include_failed: "true",
      join: "transactions",
    });
    expect(rows.map((row) => [row.from, row.to, row.value, row.fee, row.status])).toEqual([
      [SENDER, ADDRESS, "1", "100", "success"],
      [ADDRESS, OTHER, "0", undefined, "success"],
      [SENDER, ADDRESS, "16000000", "100", "success"],
      [OTHER, ADDRESS, "0", "100", "success"],
      [ADDRESS, OTHER, "20000000", "100", "success"],
      [SENDER, ADDRESS, "0", "100", "failed"],
    ]);
    expect(rows[0]).toMatchObject({
      hash: HASH,
      blockNumber: 64490662,
      timestamp: "2026-09-18T13:44:48.000Z",
      valueFormatted: "0.0000001",
      isContractInteraction: false,
      tokenTransfers: [],
    });
    expect(rows[0]?.raw).toMatchObject({ type: "payment", transaction: { memo: "hello" } });
    expect(rows[1]?.tokenTransfers).toEqual([
      {
        contract: `USDC:${USDC}`,
        symbol: "USDC",
        decimals: 7,
        value: "166900000",
        valueFormatted: "16.69",
        from: ADDRESS,
        to: OTHER,
        txHash: HASH,
        blockNumber: 64490662,
        timestamp: "2026-09-18T13:44:48.000Z",
      },
    ]);
    expect(rows[4]).toMatchObject({
      isContractInteraction: true,
      functionName: "invoke_contract",
      tokenTransfers: [{ contract: `KALE:${KALE}`, value: "1486651", from: "", to: ADDRESS }],
    });
    expect(rows[5]?.tokenTransfers).toEqual([]);
  });

  it("walks cursors to the requested page and reports an empty page past the end", async () => {
    const calls = stubRoutes([
      ["cursor=9", page([operation({ paging_token: "8" }), operation({ paging_token: "7" })])],
      ["cursor=7", page([operation({ paging_token: "6" })])],
      ["", page([operation({ paging_token: "10" }), operation({ paging_token: "9" })])],
    ]);
    const provider = await create("horizon");
    const third = await provider.getTxHistory(ADDRESS, "stellar", {
      limit: 2,
      page: 3,
      sort: "asc",
    });
    expect(third.map((row) => row.raw?.paging_token)).toEqual(["6"]);
    expect(calls.map((call) => [call.query.get("cursor"), call.query.get("order")])).toEqual([
      [null, "asc"],
      ["9", "asc"],
      ["7", "asc"],
    ]);
    await expect(provider.getTxHistory(ADDRESS, "stellar", { limit: 2, page: 4 })).resolves.toEqual(
      [],
    );
  });

  it("clamps the limit to Horizon's page size and rejects windows it cannot serve", async () => {
    const calls = stubRoutes([["", page([])]]);
    const provider = await create("horizon");
    await expect(provider.getTxHistory(ADDRESS, "stellar", { limit: 999 })).resolves.toEqual([]);
    expect(calls[0]?.query.get("limit")).toBe("200");
    for (const options of [
      { page: 11 },
      { page: 0 },
      { page: 1.5 },
      { startBlock: 1 },
      { endBlock: 5 },
    ]) {
      await expect(provider.getTxHistory(ADDRESS, "stellar", options)).rejects.toThrow(
        ExplorerError,
      );
    }
    expect(calls).toHaveLength(1);
  });

  it("rejects a page with more records than asked or a malformed record", async () => {
    stubRoutes([["", page([operation(), operation({ paging_token: "2" })])]]);
    const provider = await create("horizon");
    await expect(provider.getTxHistory(ADDRESS, "stellar", { limit: 1 })).rejects.toThrow(
      "Invalid Horizon payments response",
    );
    stubRoutes([["", page([operation({ amount: "1.5e3" })])]]);
    await expect(provider.getTxHistory(ADDRESS)).rejects.toThrow(
      "Invalid Horizon payments response",
    );
  });
});

describe("horizon token transfers", () => {
  const payments = [
    operation({ paging_token: "5" }),
    operation({
      paging_token: "4",
      asset_type: "credit_alphanum4",
      asset_code: "USDC",
      asset_issuer: USDC,
      amount: "1.0000000",
    }),
    operation({
      paging_token: "3",
      asset_type: "credit_alphanum4",
      asset_code: "KALE",
      asset_issuer: KALE,
      amount: "2.0000000",
    }),
    operation({
      paging_token: "2",
      asset_type: "credit_alphanum4",
      asset_code: "USDC",
      asset_issuer: USDC,
      amount: "3.0000000",
      transaction_successful: false,
    }),
    operation({
      paging_token: "1",
      asset_type: "credit_alphanum12",
      asset_code: "USDCTESTNET",
      asset_issuer: USDC,
      amount: "4.0000000",
    }),
  ];

  it("keeps issued-asset payments, filters one asset and pages the matches", async () => {
    const calls = stubRoutes([["", page(payments)]]);
    const provider = await create("horizon");
    const all = await provider.getTokenTransfers?.(ADDRESS);
    expect(all?.map((transfer) => [transfer.symbol, transfer.value])).toEqual([
      ["USDC", "10000000"],
      ["KALE", "20000000"],
      ["USDCTESTNET", "40000000"],
    ]);
    expect(calls[0]?.query.get("limit")).toBe("200");
    const usdc = await provider.getTokenTransfers?.(ADDRESS, "stellar", { token: `USDC:${USDC}` });
    expect(usdc?.map((transfer) => transfer.value)).toEqual(["10000000"]);
    const second = await provider.getTokenTransfers?.(ADDRESS, "stellar", { limit: 2, page: 2 });
    expect(second?.map((transfer) => transfer.symbol)).toEqual(["USDCTESTNET"]);
  });

  it("scans at most five full pages for a filtered asset", async () => {
    const full = Array.from({ length: 200 }, (_, index) =>
      operation({ paging_token: String(1000 - index) }),
    );
    const calls = stubRoutes([["", page(full)]]);
    const provider = await create("horizon");
    await expect(
      provider.getTokenTransfers?.(ADDRESS, "stellar", { token: `USDC:${USDC}` }),
    ).resolves.toEqual([]);
    expect(calls).toHaveLength(5);
    expect(calls.map((call) => call.query.get("cursor"))).toEqual([
      null,
      "801",
      "801",
      "801",
      "801",
    ]);
  });
});

describe("horizon transaction detail", () => {
  it("reads the transaction with its operations and picks the first payment as the row", async () => {
    const calls = stubRoutes([
      [
        "/operations",
        page([
          operation({
            type: "change_trust",
            asset_type: undefined,
            from: undefined,
            to: undefined,
            amount: undefined,
            transaction: undefined,
          }),
          operation({
            paging_token: "2",
            transaction: undefined,
            from: SENDER,
            to: OTHER,
            amount: "7.5000000",
          }),
          operation({
            paging_token: "3",
            transaction: undefined,
            asset_type: "credit_alphanum4",
            asset_code: "USDC",
            asset_issuer: USDC,
            amount: "1.0000000",
          }),
        ]),
      ],
      ["", transaction({ operation_count: 3, fee_charged: "300" })],
    ]);
    const provider = await create("horizon");
    const detail = await provider.getTxDetail?.(HASH);
    expect(calls.map((call) => call.path)).toEqual([
      `/transactions/${HASH}`,
      `/transactions/${HASH}/operations`,
    ]);
    expect(calls[1]?.query.get("include_failed")).toBe("true");
    expect(detail).toMatchObject({
      hash: HASH,
      blockNumber: 64490662,
      timestamp: "2026-09-18T13:44:48.000Z",
      from: SENDER,
      to: OTHER,
      value: "75000000",
      valueFormatted: "7.5",
      fee: "300",
      status: "success",
      isContractInteraction: false,
      tokenTransfers: [{ contract: `USDC:${USDC}`, value: "10000000", txHash: HASH }],
    });
    expect(detail?.raw).toMatchObject({ memo: "hello", operation_count: 3 });
  });

  it("flags Soroban transactions and keeps a failed one without transfers", async () => {
    stubRoutes([
      [
        "/operations",
        page([
          operation({
            type: "invoke_host_function",
            transaction: undefined,
            transaction_successful: false,
            asset_type: undefined,
            from: undefined,
            to: undefined,
            amount: undefined,
            asset_balance_changes: [
              {
                asset_type: "credit_alphanum4",
                asset_code: "KALE",
                asset_issuer: KALE,
                type: "transfer",
                from: SENDER,
                to: OTHER,
                amount: "1.0000000",
              },
            ],
          }),
        ]),
      ],
      ["", transaction({ successful: false })],
    ]);
    const provider = await create("horizon");
    expect(await provider.getTxDetail?.(HASH)).toMatchObject({
      from: SENDER,
      to: null,
      value: "0",
      status: "failed",
      functionName: "invoke_host_function",
      isContractInteraction: true,
      tokenTransfers: [],
    });
  });

  it("reads a contract call whose balance changes Horizon sends as null", async () => {
    stubRoutes([
      [
        "/operations",
        page([
          operation({
            type: "invoke_host_function",
            transaction: undefined,
            asset_type: undefined,
            from: undefined,
            to: undefined,
            amount: undefined,
            function: "HostFunctionTypeHostFunctionTypeInvokeContract",
            asset_balance_changes: null,
          }),
        ]),
      ],
      ["", transaction()],
    ]);
    const provider = await create("horizon");
    expect(await provider.getTxDetail?.(HASH)).toMatchObject({
      from: SENDER,
      to: null,
      value: "0",
      fee: "100",
      status: "success",
      functionName: "invoke_contract",
      isContractInteraction: true,
      tokenTransfers: [],
    });
  });

  it("falls back to the source account when no operation moves value", async () => {
    stubRoutes([
      ["/operations", page([])],
      ["", transaction()],
    ]);
    const provider = await create("horizon");
    expect(await provider.getTxDetail?.(HASH)).toMatchObject({
      from: SENDER,
      to: null,
      value: "0",
      fee: "100",
      tokenTransfers: [],
    });
  });

  it("rejects a hash mismatch and malformed hashes before I/O", async () => {
    const calls = stubRoutes([
      ["/operations", page([])],
      ["", transaction({ hash: "b".repeat(64) })],
    ]);
    const provider = await create("horizon");
    await expect(provider.getTxDetail?.(HASH)).rejects.toThrow(
      "Invalid Horizon transaction response",
    );
    await expect(provider.getTxDetail?.("xyz")).rejects.toThrow("Invalid Stellar transaction hash");
    await expect(provider.getTxDetail?.(HASH, "ethereum")).rejects.toThrow(UnsupportedChainError);
    expect(calls).toHaveLength(2);
  });
});
