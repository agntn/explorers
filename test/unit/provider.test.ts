import { afterEach, describe, expect, it, vi } from "vitest";
import { Provider, create, register } from "../../src/index.js";
import type { ProviderCapabilities, ProviderConfig } from "../../src/index.js";

class Custom extends Provider {
  static readonly key = "abstract-provider-test";

  readonly config: ProviderConfig;

  constructor(config: ProviderConfig) {
    super(config);
    this.config = config;
  }
  get capabilities(): ProviderCapabilities {
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

  async getBalance(): Promise<never> {
    throw new Error("not used");
  }

  async getTxHistory(): Promise<never> {
    throw new Error("not used");
  }

  request(url: string): Promise<Record<string, unknown>> {
    return this.getJSON(url);
  }
}

const BUILT_IN_PROVIDERS = [
  "etherscan",
  "blockscout",
  "blockchair",
  "mempool",
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
  it("constructs a registered subclass and forwards its config", () => {
    register(Custom);

    const config = { baseUrl: "https://example.test" };
    const provider = create("abstract-provider-test", config);

    expect(provider).toBeInstanceOf(Provider);
    expect(provider).toBeInstanceOf(Custom);
    if (!(provider instanceof Custom)) {
      throw new Error("registry returned the wrong provider class");
    }
    expect(provider.name).toBe("abstract-provider-test");
    expect(provider.config).toEqual(config);
  });

  it.each(BUILT_IN_PROVIDERS)("%s extends Provider", (name) => {
    const provider = create(name, { apiKey: "test" });
    expect(provider).toBeInstanceOf(Provider);
    expect(provider.name).toBe(name);
    expect(provider.getTxDetail !== undefined).toBe(provider.capabilities.txDetail);
    expect(provider.getContractInfo !== undefined).toBe(provider.capabilities.contractInfo);
    expect(provider.getTokenBalances !== undefined).toBe(provider.capabilities.tokenBalances);
    expect(provider.getTokenTransfers !== undefined).toBe(provider.capabilities.tokenTransfers);
    expect(provider.getGasData !== undefined).toBe(provider.capabilities.gasData);
    expect(provider.getBlockInfo !== undefined).toBe(provider.capabilities.blockInfo);
  });

  it("keeps unsupported optional operations absent at runtime", () => {
    const provider = create("ton");
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
