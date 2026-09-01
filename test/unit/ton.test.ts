/** TON provider tests with stubbed tonapi.io responses. */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "../../src/core/registry.js";

// A known TON address with balance
const KNOWN_TON = "EQD__________________________________________0voM";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("Unexpected network request in unit test");
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ton provider", () => {
  let provider: Awaited<ReturnType<typeof create>>;

  beforeAll(async () => {
    provider = await create("ton");
  });

  it("reports capabilities", () => {
    const caps = provider.capabilities;
    expect(caps.balances).toBe(true);
    expect(caps.txHistory).toBe(true);
    expect(caps.blockInfo).toBe(false);
    expect(caps.txDetail).toBe(false);
    expect(caps.contractInfo).toBe(false);
    expect(caps.tokenBalances).toBe(false);
    expect(provider.getBlockInfo).toBeUndefined();
  });

  it("maps an account balance from nanoton", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            address: KNOWN_TON,
            balance: 1_250_000_000,
            status: "active",
            last_activity: 1_700_000_000,
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetch);

    await expect(provider.getBalance(KNOWN_TON, "ton")).resolves.toMatchObject({
      address: KNOWN_TON,
      chain: "ton",
      balance: "1250000000",
      balanceFormatted: "1.25",
      symbol: "TON",
    });
    expect(String(fetch.mock.calls[0]?.[0])).toBe(`https://tonapi.io/v2/accounts/${KNOWN_TON}`);
  });

  it("maps a finished TON transfer", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            events: [
              {
                event_id: "event",
                timestamp: 1_700_000_000,
                in_progress: false,
                actions: [
                  {
                    type: "TonTransfer",
                    status: "ok",
                    TonTransfer: {
                      sender: { address: "sender" },
                      recipient: { address: "recipient" },
                      amount: 2_500_000_000,
                    },
                  },
                ],
                involved: {},
              },
            ],
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetch);

    const [transaction] = await provider.getTxHistory(KNOWN_TON, "ton", { limit: 3 });

    expect(transaction).toMatchObject({
      hash: "event",
      timestamp: "2023-11-14T22:13:20.000Z",
      from: "sender",
      to: "recipient",
      value: "2500000000",
      valueFormatted: "2.5",
      status: "success",
      isContractInteraction: false,
    });
    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      `https://tonapi.io/v2/accounts/${KNOWN_TON}/events?limit=3`,
    );
  });

  it("reports unfinished events as pending", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              events: [
                {
                  event_id: "event",
                  timestamp: 1,
                  in_progress: true,
                  actions: [
                    {
                      type: "TonTransfer",
                      status: "ok",
                      TonTransfer: {
                        sender: { address: "sender" },
                        recipient: { address: "recipient" },
                        amount: "1",
                      },
                    },
                  ],
                  involved: {},
                },
              ],
            }),
            { headers: { "Content-Type": "application/json" } },
          ),
      ),
    );

    const [transaction] = await provider.getTxHistory(KNOWN_TON, "ton", { limit: 1 });

    expect(transaction?.status).toBe("pending");
  });

  it("normalizes Jetton actions as token transfers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              events: [
                {
                  event_id: "event",
                  timestamp: 1,
                  actions: [
                    {
                      type: "JettonTransfer",
                      status: "ok",
                      JettonTransfer: {
                        sender: { address: "sender" },
                        recipient: { address: "recipient" },
                        senders_wallet: "sender-wallet",
                        recipients_wallet: "recipient-wallet",
                        amount: "1230000",
                        jetton: {
                          address: "jetton",
                          name: "Token",
                          symbol: "TKN",
                          decimals: 6,
                        },
                      },
                    },
                  ],
                  involved: {},
                },
              ],
            }),
            { headers: { "Content-Type": "application/json" } },
          ),
      ),
    );

    const [transaction] = await provider.getTxHistory(KNOWN_TON, "ton", { limit: 1 });

    expect(transaction).toMatchObject({
      from: "sender",
      to: "recipient",
      value: "0",
      tokenTransfers: [
        {
          contract: "jetton",
          symbol: "TKN",
          value: "1230000",
          valueFormatted: "1.23",
        },
      ],
    });
  });

  it("getBalance throws for non-ton chain", async () => {
    await expect(provider.getBalance(KNOWN_TON, "ethereum")).rejects.toThrow();
  });
});
