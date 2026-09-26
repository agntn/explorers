import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  AuthError,
  NotFoundError,
  RateLimitError,
  UnsupportedChainError,
} from "../../src/core/errors.ts";
import { create } from "../../src/core/registry.ts";
import { withProvider } from "../../src/core/resolve.ts";
import { Blockchair } from "../../src/providers/blockchair.ts";

const BTC_ADDRESS = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh";
const ETH_ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const XEC_ADDRESS = "ecash:prfhcnyqnl5cgrnmlfmms675w93ld7mvvqd0y8lz07";
/* RetiredCoder's mini-puzzle prize for puzzle 130. At height 970065 Haskoin Store counts 14
   transactions and 2.5900718 BCH received, all of it spent since. */
const BCH_ADDRESS = "bitcoincash:qz3yjg59ypg6jqpwhaxgvjj44jm4hdx0w5wsxw2qez";
/* A busy transparent Zcash address. Blockchair read it at height 3495566 on 2026-09-25. */
const ZEC_ADDRESS = "t1YQV51DKzKP63xJcynXuRfryMjfmgTJ7Jc";
/* The 2-of-2 multisig that sent 197 650 LTC in block 3183898 on 2026-09-25, trimmed from
   Blockchair's transaction dashboard for 8a0670f5...a114b. */
const LTC_ADDRESS = "ltc1q7tm3qxw59zatfzw4993l6h30sp2jwa7dhem62z8v4tw0ty7vl2rsmf963x";

function stubJSON(body: unknown) {
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () =>
      new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

/* What Blockchair answers, with status 402, for a key it does not know. */
const REJECTED = "Invalid API token. Please contact us at info@blockchair.com.";

const BLOCKED =
  "Your IP address is temporary blacklisted due to exceeding usage of API resources. Please apply for an API key by contacting us at info@blockchair.com";

function stubStatus(status: number, error?: string) {
  const body = { data: null, context: { code: status, ...(error === undefined ? {} : { error }) } };
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("blockchair provider", () => {
  it("keeps the Blockchair tip with a dated Bitcoin balance", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-08-28T12:34:56.789Z");
    stubJSON({
      data: {
        [BTC_ADDRESS]: {
          address: { balance: 123456789, received: "223456789", spent: 100000000 },
        },
      },
      context: { code: 200, state: 912345 },
    });
    const provider = await create("blockchair");

    const balance = await provider.getBalance(BTC_ADDRESS, "bitcoin");

    expect(balance).toMatchObject({
      balance: "123456789",
      balanceFormatted: "1.23456789",
      symbol: "BTC",
      funded: "223456789",
      spent: "100000000",
      fetchedAt: "2026-08-28T12:34:56.789Z",
      blockNumber: 912345,
      blockHash: null,
    });
  });

  it("formats eCash balances at two decimals", async () => {
    const fetch = stubJSON({
      data: {
        [XEC_ADDRESS]: {
          address: { balance: 123456789, received: 223456789, spent: 100000000 },
        },
      },
      context: { code: 200 },
    });
    const provider = await create("blockchair");

    const balance = await provider.getBalance(XEC_ADDRESS, "ecash");

    expect(balance).toMatchObject({
      balance: "123456789",
      balanceFormatted: "1234567.89",
      symbol: "XEC",
      funded: "223456789",
      spent: "100000000",
    });
    expect(String(fetch.mock.calls[0]?.[0])).toContain("/ecash/dashboards/address/");
  });

  it("reads a Bitcoin Cash balance by CashAddr", async () => {
    const fetch = stubJSON({
      data: {
        [BCH_ADDRESS]: {
          address: {
            type: "pubkeyhash",
            balance: 0,
            received: 259007180,
            spent: 259007180,
            transaction_count: 14,
          },
        },
      },
      context: { code: 200, state: 970065 },
    });
    const provider = await create("blockchair");

    const balance = await provider.getBalance(BCH_ADDRESS, "bitcoincash");

    expect(balance).toMatchObject({
      address: BCH_ADDRESS,
      chain: "bitcoincash",
      balance: "0",
      balanceFormatted: "0",
      symbol: "BCH",
      funded: "259007180",
      spent: "259007180",
      blockNumber: 970065,
    });
    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      `https://api.blockchair.com/bitcoin-cash/dashboards/address/${encodeURIComponent(BCH_ADDRESS)}`,
    );
  });

  it("reads a transparent Zcash balance in zatoshis", async () => {
    const fetch = stubJSON({
      data: {
        [ZEC_ADDRESS]: {
          address: {
            type: "pubkeyhash",
            balance: 331532453371,
            received: 850160060998916,
            spent: 849828528545545,
            transaction_count: 293389,
          },
        },
      },
      context: { code: 200, state: 3495566 },
    });
    const provider = await create("blockchair");

    const balance = await provider.getBalance(ZEC_ADDRESS, "zcash");

    expect(balance).toMatchObject({
      address: ZEC_ADDRESS,
      chain: "zcash",
      balance: "331532453371",
      balanceFormatted: "3315.32453371",
      symbol: "ZEC",
      funded: "850160060998916",
      spent: "849828528545545",
      blockNumber: 3495566,
    });
    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      `https://api.blockchair.com/zcash/dashboards/address/${ZEC_ADDRESS}`,
    );
  });

  it("does not label account balances as UTXO funding", async () => {
    stubJSON({
      data: {
        [ETH_ADDRESS]: {
          address: { balance: "1", received: "2", spent: "1" },
        },
      },
      context: { code: 200 },
    });
    const provider = await create("blockchair");

    const balance = await provider.getBalance(ETH_ADDRESS, "ethereum");

    expect(balance).not.toHaveProperty("funded");
    expect(balance).not.toHaveProperty("spent");
  });

  it("maps eCash transactions through the UTXO shape", async () => {
    stubJSON({
      data: {
        tx: {
          transaction: {
            hash: "ab".repeat(32),
            block_id: 800000,
            time: "2026-08-26 12:00:00",
            output_total: 5000,
            fee: 219,
          },
        },
      },
      context: { code: 200 },
    });
    const provider = await create("blockchair");

    const transaction = await provider.getTxDetail("ab".repeat(32), "ecash");

    expect(transaction).toMatchObject({
      value: "5000",
      valueFormatted: "50",
      fee: "219",
      status: "success",
      isContractInteraction: false,
    });
  });

  it("maps a transparent Zcash transfer through the UTXO shape", async () => {
    const hash = "a112ffff7397e129fb64d3f3d522c4440d4558c46b454971d8444bd0c8db6d86";
    stubJSON({
      data: {
        [hash]: {
          transaction: {
            block_id: 3495500,
            hash,
            time: "2026-09-25 08:03:01",
            is_coinbase: false,
            input_total: 7029990000,
            output_total: 7029980000,
            fee: 10000,
            shielded_value_delta: 0,
          },
          inputs: [],
          outputs: [],
        },
      },
      context: { code: 200 },
    });
    const provider = await create("blockchair");

    const transaction = await provider.getTxDetail(hash, "zcash");

    expect(transaction).toMatchObject({
      hash,
      blockNumber: 3495500,
      timestamp: "2026-09-25T08:03:01.000Z",
      from: "",
      to: null,
      value: "7029980000",
      valueFormatted: "70.2998",
      fee: "10000",
      status: "success",
      isContractInteraction: false,
    });
  });

  it("reads a Litecoin transaction in litoshis", async () => {
    const hash = "8a0670f5f0b5506d04777e8d84f6b598abcc144993231f9094beed11e37a114b";
    const fetch = stubJSON({
      data: {
        [hash]: {
          transaction: {
            block_id: 3183898,
            hash,
            time: "2026-09-25 03:08:17",
            is_coinbase: false,
            input_count: 2,
            output_count: 2,
            input_total: 19765422931560,
            output_total: 19765422928880,
            fee: 2680,
          },
          inputs: [{ index: 1, value: 8692484157928, recipient: LTC_ADDRESS }],
          outputs: [
            {
              index: 0,
              value: 19765000000000,
              recipient: "ltc1qcfxz37cdmd235t0375f2ausfcltuw3q2mxutsmnu9p4px9w0t6fq7l95pa",
            },
            { index: 1, value: 422928880, recipient: LTC_ADDRESS },
          ],
        },
      },
      context: { code: 200, state: 3184044 },
    });
    const provider = await create("blockchair");

    const transaction = await provider.getTxDetail(hash, "litecoin");

    expect(transaction).toMatchObject({
      hash,
      blockNumber: 3183898,
      timestamp: "2026-09-25T03:08:17.000Z",
      to: null,
      value: "19765422928880",
      valueFormatted: "197654.2292888",
      fee: "2680",
      status: "success",
      isContractInteraction: false,
    });
    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      `https://api.blockchair.com/litecoin/dashboards/transaction/${hash}`,
    );
  });

  it("maps Ethereum transaction fields without multiplying wei", async () => {
    stubJSON({
      data: {
        "0xtx": {
          transaction: {
            hash: "0xtx",
            block_id: 123,
            time: "2026-08-09 18:00:00",
            fee: "21000000000000",
            sender: ETH_ADDRESS,
            recipient: "0x0000000000000000000000000000000000000001",
            value: "1000000000000000000",
            gas_used: 21000,
            gas_price: "1000000000",
            failed: true,
            input_hex: "a9059cbb",
          },
        },
      },
      context: { code: 200 },
    });
    const provider = await create("blockchair");

    const transaction = await provider.getTxDetail("0xtx", "ethereum");

    expect(transaction).toMatchObject({
      from: ETH_ADDRESS,
      to: "0x0000000000000000000000000000000000000001",
      timestamp: "2026-08-09T18:00:00.000Z",
      value: "1000000000000000000",
      valueFormatted: "1",
      gasUsed: "21000",
      gasPrice: "1000000000",
      fee: "21000000000000",
      status: "failed",
      isContractInteraction: true,
    });
  });

  it.each([
    ["bitcoin", "bitcoin"],
    ["bitcoincash", "bitcoin-cash"],
    ["litecoin", "litecoin"],
    ["ecash", "ecash"],
    ["zcash", "zcash"],
  ] as const)("reads the genesis block on %s by height", async (chain, slug) => {
    const hash = "000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f";
    const fetch = stubJSON({
      data: {
        "0": {
          block: { id: 0, hash, time: "2009-01-03 18:15:05", transaction_count: 1 },
          transactions: [],
        },
      },
      context: { code: 200 },
    });
    const provider = new Blockchair({});

    expect(await provider.getBlockInfo(0, chain)).toEqual({
      number: 0,
      hash,
      parentHash: "",
      timestamp: "2009-01-03T18:15:05.000Z",
      miner: "",
      gasUsed: "0",
      gasLimit: "0",
      txCount: 1,
      baseFee: undefined,
    });
    expect(String(fetch.mock.calls[0]?.[0])).toContain(`/${slug}/dashboards/blocks/0`);
  });

  it("maps Ethereum block fields without counting the paginated transaction list", async () => {
    const hash = "0xda214d1b1d458e7ae0e626b69a52a59d19762c51a53ff64813c4d31256282fdf";
    stubJSON({
      data: {
        "2345678": {
          block: {
            id: 2345678,
            hash,
            time: "2016-09-29 01:39:41",
            miner: "0x4bb96091ee9d802ed039c4d1a5f6216f90f81b01",
            gas_used: 105000,
            gas_limit: 1500000,
            transaction_count: 5,
          },
          transactions: [],
        },
      },
      context: { code: 200 },
    });
    const provider = new Blockchair({});

    expect(await provider.getBlockInfo(2345678, "ethereum")).toEqual({
      number: 2345678,
      hash,
      parentHash: "",
      timestamp: "2016-09-29T01:39:41.000Z",
      miner: "0x4bb96091ee9d802ed039c4d1a5f6216f90f81b01",
      gasUsed: "105000",
      gasLimit: "1500000",
      txCount: 5,
      baseFee: undefined,
    });
  });

  it("reports a missing block as not found", async () => {
    stubJSON({ data: {}, context: { code: 200, results: 0 } });
    const provider = new Blockchair({});

    await expect(provider.getBlockInfo(9999999, "ecash")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("joins a custom base URL with the chain path exactly once", async () => {
    const fetch = stubJSON({
      data: { [ETH_ADDRESS]: { address: { balance: "0" } } },
      context: { code: 200 },
    });
    const provider = await create("blockchair", { baseUrl: "https://example.test/" });

    await provider.getBalance(ETH_ADDRESS, "ethereum");

    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      `https://example.test/ethereum/dashboards/address/${ETH_ADDRESS}`,
    );
  });

  it("rejects explorer slugs that Blockchair does not serve", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const provider = await create("blockchair");

    await expect(provider.getBalance(ETH_ADDRESS, "base")).rejects.toBeInstanceOf(
      UnsupportedChainError,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reads a keyless IP block as a rate limit that names the key", async () => {
    vi.stubEnv("BLOCKCHAIR_API_KEY", "");
    const fetch = stubStatus(430, BLOCKED);
    const provider = await create("blockchair");

    const error = await provider.getBalance(BTC_ADDRESS, "bitcoin").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RateLimitError);
    expect(error).toMatchObject({ provider: "blockchair" });
    expect((error as Error).message).toBe(
      `Rate limited by blockchair: ${BLOCKED}; set BLOCKCHAIR_API_KEY to lift the block`,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["an empty variable", "", "https://api.blockchair.com/bitcoin/dashboards/blocks/1"],
    [
      "a set variable",
      "configured",
      "https://api.blockchair.com/bitcoin/dashboards/blocks/1?key=configured",
    ],
  ])("sends the key only for %s", async (_, key, url) => {
    vi.stubEnv("BLOCKCHAIR_API_KEY", key);
    const fetch = stubStatus(430, BLOCKED);
    const provider = new Blockchair({});

    await provider.getBlockInfo(1, "bitcoin").catch(() => undefined);

    expect(String(fetch.mock.calls[0]?.[0])).toBe(url);
  });

  it.each([402, 434, 435, 436, 437])("reads HTTP %i as a Blockchair limit", async (status) => {
    stubStatus(status, "Limit exceeded");
    const provider = new Blockchair({ apiKey: "configured" });

    const error = await provider.getTxDetail("ab".repeat(32), "bitcoin").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as Error).message).toBe("Rate limited by blockchair: Limit exceeded");
  });

  it("reads a rejected key as an authentication failure", async () => {
    stubStatus(402, REJECTED);
    const provider = new Blockchair({ apiKey: "bogus" });

    const error = await provider.getBalance(BTC_ADDRESS, "bitcoin").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AuthError);
    expect((error as Error).message).toBe(`Authentication failed for blockchair: ${REJECTED}`);
  });

  it("keeps an automatic read on Blockchair when it rejects the key", async () => {
    vi.stubEnv("BLOCKCHAIR_API_KEY", "bogus");
    const fetch = stubStatus(402, REJECTED);

    const error = await withProvider(undefined, "bitcoin", ({ provider }) =>
      provider.getBalance(BTC_ADDRESS, "bitcoin"),
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AuthError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("names the status when a limit arrives without a reason", async () => {
    stubStatus(430);
    const provider = new Blockchair({ apiKey: "configured" });

    await expect(provider.getBlockInfo(1, "bitcoin")).rejects.toThrow(
      "Rate limited by blockchair: HTTP 430",
    );
  });

  it("moves an automatic read to the next provider when Blockchair is over its limit", async () => {
    vi.stubEnv("BLOCKCHAIR_API_KEY", "configured");
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      if (String(input).startsWith("https://api.blockchair.com/")) {
        return new Response(
          JSON.stringify({ data: null, context: { code: 402, error: "Limit" } }),
          {
            status: 402,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      return new Response(
        JSON.stringify({
          address: BTC_ADDRESS,
          chain_stats: { funded_txo_sum: 5, spent_txo_sum: 0, tx_count: 1 },
          mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 },
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetch);

    const read = await withProvider(undefined, "bitcoin", async ({ name, provider }) => ({
      name,
      balance: (await provider.getBalance(BTC_ADDRESS, "bitcoin")).balance,
    }));

    expect(read).toEqual({ name: "mempool", balance: "5" });
  });
});
