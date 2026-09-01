/** ENS helper tests with stubbed resolver responses. */
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { isEnsName, isAddress, resolveEns } from "../../src/core/ens.js";

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

describe("ens helpers", () => {
  it("isEnsName recognizes .eth names", () => {
    expect(isEnsName("vitalik.eth")).toBe(true);
    expect(isEnsName("oritwoen.eth")).toBe(true);
    expect(isEnsName("sub.domain.eth")).toBe(true);
    expect(isEnsName("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045")).toBe(false);
    expect(isEnsName("notens")).toBe(false);
    expect(isEnsName(".eth")).toBe(false);
  });

  it("isAddress recognizes 0x addresses", () => {
    expect(isAddress("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045")).toBe(true);
    expect(isAddress("0x0000000000000000000000000000000000000000")).toBe(true);
    expect(isAddress("vitalik.eth")).toBe(false);
    expect(isAddress("not-an-address")).toBe(false);
  });

  it("encodes names before adding them to resolver URLs", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" }), {
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetch);

    await resolveEns("name#.eth");

    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("https://api.ensideas.com/ens/resolve/name%23.eth");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("falls through to the next resolver when the first one fails", async () => {
    const fetch = vi.fn(async (input: string | URL | Request) =>
      String(input).startsWith("https://api.ensideas.com/")
        ? new Response(null, { status: 503 })
        : new Response(JSON.stringify({ address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" }), {
            headers: { "Content-Type": "application/json" },
          }),
    );
    vi.stubGlobal("fetch", fetch);

    await expect(resolveEns("vitalik.eth")).resolves.toBe(
      "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    );
    expect(fetch.mock.calls.map(([input]) => String(input))).toEqual([
      "https://api.ensideas.com/ens/resolve/vitalik.eth",
      "https://api.ensdata.net/vitalik.eth",
    ]);
  });

  it("returns null when no resolver knows the name", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) =>
        String(input).startsWith("https://api.ensideas.com/")
          ? new Response(null, { status: 404 })
          : new Response(JSON.stringify({ address: null }), {
              headers: { "Content-Type": "application/json" },
            }),
      ),
    );

    await expect(resolveEns("nobody.eth")).resolves.toBeNull();
  });
});
