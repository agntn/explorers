import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { ExplorerError, NotFoundError, UnsupportedChainError } from "../../src/core/errors.ts";
import { classifyInput } from "../../src/core/input.ts";
import { create } from "../../src/core/registry.ts";
import { resolveProvider } from "../../src/core/resolve.ts";
import { XRPScan } from "../../src/providers/xrpscan.ts";

const BASE = "https://api.xrpscan.com/api/v1";
const BITSTAMP = "rDsbeomae4FXwgQTJp9Rs64Qg9vDiTCdBv";
const HOLDER = "rGFuMiw48HdbnrUbkRYuitXTmfrDBNTCnX";
/* Generated for this test and never funded. */
const UNFUNDED = "rUARS29JG6X3pEtMLPW3SYCK6zKuWVsS6H";

/* Rows as XRPSCAN sent them, cut to the fields the provider reads. */
const xrpPayment = {
  hash: "1DE7B7EF3946FC6C775B1B3C8D828C496B6F665EA47565C8B3CAC6CFA1651030",
  ledger_index: 107_874_210,
  date: "2026-10-24T15:41:00.000Z",
  TransactionType: "Payment",
  Account: "rMvCasZ9cohYrSZRNYPTZfoaaSUQMfgQ8G",
  Destination: BITSTAMP,
  DestinationTag: 49_716_195,
  Fee: "10000",
  Amount: { value: 8_857_307_393, currency: "XRP" },
  validated: true,
  meta: {
    TransactionResult: "tesSUCCESS",
    delivered_amount: { value: 8_857_307_393, currency: "XRP" },
  },
};

const usdPayment = {
  hash: "4266320B39DAFC447856B48B08AD1C098B92A19B79396C8D5AE84018028F470D",
  ledger_index: 107_851_581,
  date: "2026-10-23T14:59:20.000Z",
  TransactionType: "Payment",
  Account: HOLDER,
  Destination: "rK9eLmqw7NQ9zNcHZQJmqWXKU4KwHXM2KK",
  Fee: "20000",
  Amount: { currency: "USD", issuer: "rK9eLmqw7NQ9zNcHZQJmqWXKU4KwHXM2KK", value: "0.01" },
  validated: true,
  meta: {
    TransactionResult: "tesSUCCESS",
    delivered_amount: {
      currency: "USD",
      issuer: "rK9eLmqw7NQ9zNcHZQJmqWXKU4KwHXM2KK",
      value: "0.01",
    },
  },
};

const offer = {
  hash: "07A97864BE5C190649F00EDC04C1ECF3CEAD68A589BF6D4EEE36B20813B8FEF9",
  ledger_index: 107_874_242,
  date: "2026-10-24T15:43:02.000Z",
  TransactionType: "OfferCreate",
  Account: "rBTwLga3i2gz3doX6Gva3MgEV8ZCD8jjah",
  Fee: "10",
  Flags: 0,
  validated: true,
  meta: { TransactionResult: "tesSUCCESS" },
};

/* A partial payment asking 10^17 drops, past 2^53, sent as text for the integer guard. */
const PARTIAL_HASH = "2BCAFD589DA75FAD0F50D5045016DA2063FE931CDF7314EAB043931E1B7D39F6";
const partialPayment = `{"meta":{"delivered_amount":{"value":13335,"currency":"XRP"},"TransactionIndex":184,"TransactionResult":"tesSUCCESS"},"Amount":{"value":100000000000000000,"currency":"XRP"},"Account":"rEqYHwNakMkL5FVVewd1cBUNs6EphiNLNF","Destination":"rEqYHwNakMkL5FVVewd1cBUNs6EphiNLNF","Fee":0,"Flags":1073938432,"TransactionType":"Payment","hash":"${PARTIAL_HASH}","ledger_index":107874279,"date":"2026-10-24T15:45:31.000Z"}`;

/* RLUSD with its 40-hex code, and /tx printing the issued value as a JSON number. */
const RLUSD_HASH = "BB65980E868C1108806372E0E241617799F7B5929182E792B2AC47BD3287F153";
const RLUSD = "524C555344000000000000000000000000000000";
const RLUSD_ISSUER = "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De";
const rlusdPayment = {
  meta: {
    delivered_amount: { currency: RLUSD, issuer: RLUSD_ISSUER, value: 0.367_169_777_519_999_9 },
    TransactionResult: "tesSUCCESS",
  },
  Amount: { currency: RLUSD, issuer: RLUSD_ISSUER, value: 9.999_999_999_999_999e95 },
  Account: "rwG5huGCbXUGsB3NXJQ4A8tdny4rax5iEa",
  Destination: "rwG5huGCbXUGsB3NXJQ4A8tdny4rax5iEa",
  Fee: 0,
  TransactionType: "Payment",
  hash: RLUSD_HASH,
  ledger_index: 107_874_286,
  date: "2026-10-24T15:46:00.000Z",
};

/* Answer every request through `route` and keep the URLs asked for, in order. */
function stubApi(route: (url: URL) => unknown): URL[] {
  const urls: URL[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: string | URL | Request) => {
      const url = new URL(request instanceof Request ? request.url : String(request));
      urls.push(url);
      const answer = route(url);
      return answer instanceof Response ? answer : Response.json(answer);
    }),
  );
  return urls;
}

function asked(urls: readonly URL[]): string[] {
  return urls.map((url) => `${url.origin}${url.pathname}${url.search}`);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("xrpscan provider", () => {
  it("serves the XRP Ledger and lands there by default", async () => {
    const provider = await create("xrpscan");

    expect(provider.capabilities).toEqual({
      balances: true,
      txHistory: true,
      txDetail: true,
      utxos: false,
      pubkeys: false,
      contractInfo: false,
      tokenBalances: true,
      tokenTransfers: false,
      gasData: false,
      blockInfo: true,
    });
    expect(resolveProvider(undefined, "xrpl")).toBe("xrpscan");
    expect(classifyInput(PARTIAL_HASH, "xrpl")).toBe("txhash");
    expect(classifyInput(BITSTAMP, "xrpl")).toBe("address");
  });

  it("reads the balance in drops from the account root", async () => {
    const urls = stubApi(() => ({
      sequence: 2_902_420,
      xrpBalance: "21522872.904801",
      Account: BITSTAMP,
      Balance: "21522872904801",
      LedgerEntryType: "AccountRoot",
    }));

    const balance = await new XRPScan().getBalance(BITSTAMP);

    expect(asked(urls)).toEqual([`${BASE}/account/${BITSTAMP}`]);
    expect(balance).toMatchObject({
      address: BITSTAMP,
      chain: "xrpl",
      balance: "21522872904801",
      balanceFormatted: "21522872.904801",
      symbol: "XRP",
      blockNumber: null,
    });
  });

  it("calls an account the ledger never funded missing, not empty", async () => {
    stubApi(() => ({
      error: {
        status: "error",
        error: "actNotFound",
        error_code: 19,
        error_message: "Account not found.",
      },
      settings: {},
    }));

    await expect(new XRPScan().getBalance(UNFUNDED)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses another chain and a malformed address before asking", async () => {
    const urls = stubApi(() => ({}));
    const provider = new XRPScan();

    await expect(provider.getBalance(BITSTAMP, "stellar")).rejects.toBeInstanceOf(
      UnsupportedChainError,
    );
    await expect(provider.getBalance("rNOTANADDRESS")).rejects.toThrow(
      "Invalid XRP Ledger address",
    );
    expect(urls).toEqual([]);
  });

  it("walks markers until the page is full and keeps only that page", async () => {
    const first = Array.from({ length: 25 }, (_, index) => ({
      ...xrpPayment,
      hash: index.toString(16).padStart(64, "0"),
    }));
    const urls = stubApi((url) =>
      url.searchParams.has("marker")
        ? { transactions: [usdPayment, offer] }
        : { transactions: first, marker: "next-one" },
    );

    const rows = await new XRPScan().getTxHistory(BITSTAMP, "xrpl", { limit: 20, page: 2 });

    expect(asked(urls)).toEqual([
      `${BASE}/account/${BITSTAMP}/transactions`,
      `${BASE}/account/${BITSTAMP}/transactions?marker=next-one`,
    ]);
    expect(rows.map((row) => row.hash)).toEqual([
      ...first.slice(20).map((row) => row.hash),
      usdPayment.hash,
      offer.hash,
    ]);
  });

  it("stops after ten markers when the pages keep coming back empty", async () => {
    const urls = stubApi(() => ({ transactions: [], marker: "again" }));

    await expect(new XRPScan().getTxHistory(BITSTAMP)).resolves.toEqual([]);
    expect(urls).toHaveLength(10);
  });

  it("maps a payment, an issued token and an offer into rows", async () => {
    stubApi(() => ({ transactions: [xrpPayment, usdPayment, offer] }));

    const [xrp, usd, offerRow] = await new XRPScan().getTxHistory(BITSTAMP);

    expect(xrp).toMatchObject({
      hash: xrpPayment.hash,
      blockNumber: 107_874_210,
      timestamp: "2026-10-24T15:41:00.000Z",
      from: "rMvCasZ9cohYrSZRNYPTZfoaaSUQMfgQ8G",
      to: BITSTAMP,
      value: "8857307393",
      valueFormatted: "8857.307393",
      fee: "10000",
      status: "success",
      isContractInteraction: false,
      tokenTransfers: [],
      raw: { DestinationTag: 49_716_195 },
    });
    expect(usd).toMatchObject({ value: "0", to: "rK9eLmqw7NQ9zNcHZQJmqWXKU4KwHXM2KK" });
    expect(usd?.tokenTransfers).toEqual([
      {
        contract: "USD.rK9eLmqw7NQ9zNcHZQJmqWXKU4KwHXM2KK",
        symbol: "USD",
        decimals: 2,
        value: "1",
        valueFormatted: "0.01",
        from: HOLDER,
        to: "rK9eLmqw7NQ9zNcHZQJmqWXKU4KwHXM2KK",
        txHash: usdPayment.hash,
        blockNumber: 107_851_581,
        timestamp: "2026-10-23T14:59:20.000Z",
      },
    ]);
    expect(offerRow).toMatchObject({ from: offer.Account, to: null, value: "0", fee: "10" });
  });

  it("marks a ledger rejection failed and drops its token movement", async () => {
    /* The USD row with the result a dry path gets, which still costs its fee. */
    const dry = {
      ...usdPayment,
      meta: { TransactionResult: "tecPATH_DRY" },
    };
    stubApi(() => ({ transactions: [dry] }));

    const [row] = await new XRPScan().getTxHistory(HOLDER);

    expect(row).toMatchObject({ status: "failed", fee: "20000", tokenTransfers: [] });
  });

  it("reads an exponent amount when an old row has no delivered amount", async () => {
    /* Before 2014 rippled wrote `unavailable` there. The amount is one XRPSCAN printed elsewhere. */
    const old = {
      ...usdPayment,
      Amount: {
        currency: "USD",
        issuer: "rKiCet8SdvWxPXnAgYarFUXMh1zCPz432Y",
        value: "9999999999999990e-1",
      },
      meta: { TransactionResult: "tesSUCCESS", delivered_amount: "unavailable" },
    };
    stubApi(() => ({ transactions: [old] }));

    const [row] = await new XRPScan().getTxHistory(HOLDER);

    expect(row?.tokenTransfers[0]).toMatchObject({
      contract: "USD.rKiCet8SdvWxPXnAgYarFUXMh1zCPz432Y",
      decimals: 0,
      value: "999999999999999",
      valueFormatted: "999999999999999",
    });
  });

  it("keeps an old partial payment at zero instead of trusting its ceiling", async () => {
    const old = {
      ...xrpPayment,
      Flags: 131_072,
      Amount: { value: 100_000_000_000, currency: "XRP" },
      meta: { TransactionResult: "tesSUCCESS", delivered_amount: "unavailable" },
    };
    stubApi(() => ({ transactions: [old] }));

    const [row] = await new XRPScan().getTxHistory(BITSTAMP);

    expect(row).toMatchObject({ value: "0", status: "success" });
  });

  it("drops an issued value whose exponent no ledger amount has", async () => {
    const absurd = {
      ...usdPayment,
      meta: {
        TransactionResult: "tesSUCCESS",
        delivered_amount: { ...usdPayment.Amount, value: "1e99999999" },
      },
    };
    stubApi(() => ({ transactions: [absurd] }));

    const [row] = await new XRPScan().getTxHistory(HOLDER);

    expect(row?.tokenTransfers).toEqual([]);
  });

  it("rejects history windows XRPSCAN cannot serve before asking", async () => {
    const urls = stubApi(() => ({ transactions: [] }));
    const provider = new XRPScan();

    await expect(provider.getTxHistory(BITSTAMP, "xrpl", { sort: "asc" })).rejects.toThrow(
      "newest first only",
    );
    await expect(provider.getTxHistory(BITSTAMP, "xrpl", { startBlock: 1 })).rejects.toThrow(
      "no ledger bounds",
    );
    await expect(
      provider.getTxHistory(BITSTAMP, "xrpl", { limit: 100, page: 3 }),
    ).rejects.toBeInstanceOf(ExplorerError);
    expect(urls).toEqual([]);
  });

  it("counts what a partial payment delivered, not the 10^17 drops it asked for", async () => {
    const urls = stubApi(
      () => new Response(partialPayment, { headers: { "content-type": "application/json" } }),
    );

    const tx = await new XRPScan().getTxDetail(PARTIAL_HASH);

    expect(asked(urls)).toEqual([`${BASE}/tx/${PARTIAL_HASH}`]);
    expect(tx).toMatchObject({ value: "13335", valueFormatted: "0.013335", fee: "0" });
    expect(tx.raw?.["Amount"]).toEqual({ value: "100000000000000000", currency: "XRP" });
  });

  it("names a hex currency by its text and keeps a numeric issued value exact", async () => {
    stubApi(() => rlusdPayment);

    const tx = await new XRPScan().getTxDetail(RLUSD_HASH);

    expect(tx.value).toBe("0");
    expect(tx.tokenTransfers).toEqual([
      expect.objectContaining({
        contract: `${RLUSD}.${RLUSD_ISSUER}`,
        symbol: "RLUSD",
        decimals: 16,
        value: "3671697775199999",
        valueFormatted: "0.3671697775199999",
      }),
    ]);
  });

  it("reads a missing transaction as not found", async () => {
    stubApi(() => new Response("Not found", { status: 404 }));

    await expect(new XRPScan().getTxDetail("0".repeat(64))).rejects.toBeInstanceOf(NotFoundError);
  });

  it("lists trust line holdings with the decimals each value needs", async () => {
    const urls = stubApi(() => [
      {
        counterparty: "rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B",
        currency: "BTC",
        value: "15.36668736901176",
        counterpartyName: { username: "Bitstamp", account: "rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B" },
      },
      {
        counterparty: "rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B",
        currency: "EUR",
        value: "4920148.97911",
      },
    ]);

    const holdings = await new XRPScan().getTokenBalances(HOLDER);

    expect(asked(urls)).toEqual([`${BASE}/account/${HOLDER}/assets`]);
    expect(holdings).toEqual([
      {
        contract: "BTC.rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B",
        symbol: "BTC",
        decimals: 14,
        balance: "1536668736901176",
        balanceFormatted: "15.36668736901176",
      },
      {
        contract: "EUR.rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B",
        symbol: "EUR",
        decimals: 5,
        balance: "492014897911",
        balanceFormatted: "4920148.97911",
      },
    ]);
  });

  it("reads a ledger as a block", async () => {
    const urls = stubApi(() => ({
      ledger_index: 80_000_000,
      ledger_hash: "DB978F031BB14734213998060E077D5F813358222DAB07CA8148588D852A55DF",
      close_flags: 0,
      close_time: 1_684_953_531,
      close_time_human: "2023-05-24T18:38:51.000Z",
      close_time_resolution: 10,
      parent_close_time: 1_684_953_530,
      parent_hash: "E70235CEAA964202C74CD81132C69F8F44FE539F9E347F82AA3131410B7CDBEF",
      transaction_hash: "CDA48280EF5F88BC86164A77E1072296899B384619D552445D71C922026A3E8C",
      tx_count: 36,
    }));

    const block = await new XRPScan().getBlockInfo(80_000_000);

    expect(asked(urls)).toEqual([`${BASE}/ledger/80000000`]);
    expect(block).toEqual({
      number: 80_000_000,
      hash: "DB978F031BB14734213998060E077D5F813358222DAB07CA8148588D852A55DF",
      parentHash: "E70235CEAA964202C74CD81132C69F8F44FE539F9E347F82AA3131410B7CDBEF",
      timestamp: "2023-05-24T18:38:51.000Z",
      miner: "",
      gasUsed: "0",
      gasLimit: "0",
      txCount: 36,
    });
    await expect(new XRPScan().getBlockInfo(0)).rejects.toThrow("positive safe integer");
  });
});
