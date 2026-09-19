import { afterEach, describe, expect, it, vi } from "vitest";
import { HTTPError, Provider, RateLimitError, create, register } from "../../src/index.js";
import type { ProviderCapabilities, ProviderConfig } from "../../src/index.js";

class Custom extends Provider {
  static readonly key = "abstract-provider-test";

  readonly config: ProviderConfig;

  constructor(config: Readonly<ProviderConfig>) {
    super(config);
    this.config = config;
  }
  get capabilities(): ProviderCapabilities {
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

  async getBalance(): Promise<never> {
    throw new Error("not used");
  }

  async getTxHistory(): Promise<never> {
    throw new Error("not used");
  }

  request(url: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return this.getJSON(url, signal === undefined ? undefined : { signal });
  }

  post(url: string, body: unknown): Promise<Record<string, unknown>> {
    return this.postJSON(url, body);
  }
}

const BUILT_IN_PROVIDERS = [
  "etherscan",
  "blockscout",
  "blockchair",
  "mempool",
  "blockstream",
  "solscan",
  "ton",
  "tronscan",
  "aptos",
  "blockberry",
] as const;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("abstract provider registry", () => {
  it("constructs a registered subclass and forwards its config", async () => {
    register(Custom, { chains: ["ethereum"] });

    const config = { baseUrl: "https://example.test" };
    const provider = await create("abstract-provider-test", config);

    expect(provider).toBeInstanceOf(Provider);
    expect(provider).toBeInstanceOf(Custom);
    if (!(provider instanceof Custom)) {
      throw new Error("registry returned the wrong provider class");
    }
    expect(provider.name).toBe("abstract-provider-test");
    expect(provider.config).toEqual(config);
  });

  it.each(BUILT_IN_PROVIDERS)("%s extends Provider", async (name) => {
    const provider = await create(name, { apiKey: "test" });
    expect(provider).toBeInstanceOf(Provider);
    expect(provider.name).toBe(name);
    expect(provider.getTxDetail !== undefined).toBe(provider.capabilities.txDetail);
    expect(provider.getContractInfo !== undefined).toBe(provider.capabilities.contractInfo);
    expect(provider.getTokenBalances !== undefined).toBe(provider.capabilities.tokenBalances);
    expect(provider.getTokenTransfers !== undefined).toBe(provider.capabilities.tokenTransfers);
    expect(provider.getGasData !== undefined).toBe(provider.capabilities.gasData);
    expect(provider.getBlockInfo !== undefined).toBe(provider.capabilities.blockInfo);
  });

  it("keeps unsupported optional operations absent at runtime", async () => {
    const provider = await create("ton");
    expect(provider.getTxDetail).toBeUndefined();
    expect(provider.getContractInfo).toBeUndefined();
    expect(provider.getTokenBalances).toBeUndefined();
    expect(provider.getTokenTransfers).toBeUndefined();
    expect(provider.getGasData).toBeUndefined();
  });

  it("applies constructor timeout to inherited HTTP requests", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
            once: true,
          });
        }),
    );
    vi.stubGlobal("fetch", fetch);

    const provider = new Custom({ timeout: 25 });
    const rejection = expect(provider.request("https://example.test")).rejects.toMatchObject({
      provider: "abstract-provider-test",
    });
    await vi.advanceTimersByTimeAsync(25);

    await rejection;
    expect(fetch).toHaveBeenCalledOnce();
  });
});

describe("provider rate limit retry", () => {
  function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), {
      headers: { "Content-Type": "application/json" },
    });
  }

  it("retries an HTTP 429 and returns the next answer", async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("throttled", { status: 429, headers: { "Content-Type": "text/plain" } }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetch);

    const pending = new Custom({}).request("https://example.test/data");
    await vi.advanceTimersByTimeAsync(1000);

    await expect(pending).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("waits Retry-After seconds before retrying", async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("throttled", {
          status: 429,
          headers: { "Content-Type": "text/plain", "Retry-After": "5" },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetch);

    const pending = new Custom({}).request("https://example.test/data");
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetch).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(4000);

    await expect(pending).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("retries a JSON rate limit envelope the same way", async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ status: "0", message: "NOTOK", result: "Max rate limit reached" }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetch);

    const pending = new Custom({}).request("https://example.test/data");
    await vi.advanceTimersByTimeAsync(1000);

    await expect(pending).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("gives up after two retries on the same backend", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(
      async () =>
        new Response("throttled", { status: 429, headers: { "Content-Type": "text/plain" } }),
    );
    vi.stubGlobal("fetch", fetch);

    const pending = expect(
      new Custom({}).request("https://example.test/data"),
    ).rejects.toBeInstanceOf(RateLimitError);
    await vi.runAllTimersAsync();
    await pending;
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("does not retry a server failure", async () => {
    const fetch = vi.fn(
      async () =>
        new Response("upstream failed", { status: 500, headers: { "Content-Type": "text/plain" } }),
    );
    vi.stubGlobal("fetch", fetch);

    await expect(new Custom({}).request("https://example.test/data")).rejects.toBeInstanceOf(
      HTTPError,
    );
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("retries a 429 on POST the same way", async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("throttled", { status: 429, headers: { "Content-Type": "text/plain" } }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetch);

    const pending = new Custom({}).post("https://example.test/data", { query: "value" });
    await vi.advanceTimersByTimeAsync(1000);

    await expect(pending).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
