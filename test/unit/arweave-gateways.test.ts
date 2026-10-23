import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { Arweave } from "../../src/providers/arweave.ts";
import { Ario } from "../../src/providers/ario.ts";
import { Turbo } from "../../src/providers/turbo.ts";
import { create, getDefaultURL, supportsCapability } from "../../src/core/registry.ts";
import { resolveProvider, withProvider } from "../../src/core/resolve.ts";

const ADDRESS = "FPjbN_btYKzcf8QASjs30v5C0FPv7XpwKXENBW8dqVw";

function json(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}

function emptyHistory() {
  return json({ data: { transactions: { pageInfo: { hasNextPage: false }, edges: [] } } });
}

afterEach(() => vi.unstubAllGlobals());

describe("Arweave gateways", () => {
  it.each([
    ["turbo", Turbo, "https://turbo-gateway.com"],
    ["ario", Ario, "https://ar-io.dev"],
    ["arweave", Arweave, "https://arweave.net"],
  ])("reads %s from its own gateway", async (key, Class, gateway) => {
    const fetch = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith("/graphql")
        ? emptyHistory()
        : new Response("0", { headers: { "Content-Type": "text/plain" } }),
    );
    vi.stubGlobal("fetch", fetch);
    const provider = await create(key);
    expect(provider).toBeInstanceOf(Class);
    expect(provider.name).toBe(key);
    expect(getDefaultURL(key)).toBe(gateway);
    expect(supportsCapability(key, "txHistoryTags")).toBe(true);
    await provider.getBalance(ADDRESS, "arweave");
    await provider.getTxHistory(ADDRESS, "arweave");
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      `${gateway}/wallet/${ADDRESS}/balance`,
      `${gateway}/graphql`,
      `${gateway}/graphql`,
    ]);
  });

  it("names the gateway that refused, not the class it inherits from", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(new Turbo().getBalance(ADDRESS, "bitcoin")).rejects.toMatchObject({
      name: "UnsupportedChainError",
      provider: "turbo",
    });
    await expect(new Ario().getTxHistory("not an address")).rejects.toMatchObject({
      provider: "ario",
    });
    await expect(new Turbo().getTxHistory(ADDRESS, "arweave", { limit: 0 })).rejects.toMatchObject({
      provider: "turbo",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("starts automatic reads on Turbo and moves to ar-io.dev when its index fails", async () => {
    expect(resolveProvider(undefined, "arweave", "txHistory")).toBe("turbo");
    const fetch = vi.fn(async (input: RequestInfo | URL) =>
      String(input).startsWith("https://turbo-gateway.com/")
        ? new Response("graphql_start_timeout", { status: 570 })
        : emptyHistory(),
    );
    vi.stubGlobal("fetch", fetch);
    const answer = await withProvider(
      undefined,
      "arweave",
      async ({ name, provider }) => ({ name, rows: await provider.getTxHistory(ADDRESS) }),
      "txHistory",
    );
    expect(answer).toEqual({ name: "ario", rows: [] });
    expect(new Set(fetch.mock.calls.map(([url]) => new URL(String(url)).host))).toEqual(
      new Set(["turbo-gateway.com", "ar-io.dev"]),
    );
  });
});
