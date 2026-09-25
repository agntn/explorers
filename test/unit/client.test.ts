import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { ExplorerError, HTTPError, NotFoundError, TransportError } from "../../src/core/errors.ts";
import { getJSON, postJSON } from "../../src/core/client.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HTTP client", () => {
  it.each([
    ["GET", () => getJSON("https://example.test/data?apikey=secret", { provider: "test" })],
    [
      "POST",
      () =>
        postJSON(
          "https://example.test/data?apikey=secret",
          { query: "value" },
          { provider: "test" },
        ),
    ],
  ])("does not retry failed %s requests", async (_method, request) => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "upstream failed" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetch);

    const error = await request().catch((cause: unknown) => cause);

    expect(fetch).toHaveBeenCalledOnce();
    expect(error).toBeInstanceOf(HTTPError);
    expect(error).toMatchObject({ statusCode: 500, provider: "test" });
    expect((error as Error).message).not.toContain("secret");
    expect(JSON.stringify(error)).not.toContain("secret");
  });

  it.each([
    ["GET", () => getJSON("https://example.test/data", { provider: "test" })],
    ["POST", () => postJSON("https://example.test/data", { query: "value" }, { provider: "test" })],
  ])("preserves plain-text HTTP errors from %s requests", async (_method, request) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("Invalid request", {
            status: 400,
            headers: { "Content-Type": "text/plain" },
          }),
      ),
    );

    const error = await request().catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(HTTPError);
    expect(error).toMatchObject({ statusCode: 400, body: "Invalid request", provider: "test" });
  });

  it("classifies a plain-text 404 response as not found", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("Transaction not found", {
            status: 404,
            headers: { "Content-Type": "text/plain" },
          }),
      ),
    );

    await expect(
      getJSON(`https://example.test/tx/${"0".repeat(64)}`, { provider: "mempool" }),
    ).rejects.toMatchObject({
      name: NotFoundError.name,
      provider: "mempool",
    });
  });

  it.each([
    [
      "refused connection",
      Object.assign(new Error("connect ECONNREFUSED 203.0.113.7:443"), { code: "ECONNREFUSED" }),
      "ECONNREFUSED",
      "connect ECONNREFUSED 203.0.113.7:443",
    ],
    [
      "unresolved host",
      Object.assign(new Error("getaddrinfo ENOTFOUND example.test"), { code: "ENOTFOUND" }),
      "ENOTFOUND",
      "getaddrinfo ENOTFOUND example.test",
    ],
    [
      "refusal on every address",
      Object.assign(
        new AggregateError(
          [Object.assign(new Error("connect ECONNREFUSED ::1:443"), { code: "ECONNREFUSED" })],
          "",
        ),
        { code: "ECONNREFUSED" },
      ),
      "ECONNREFUSED",
      "connect ECONNREFUSED ::1:443",
    ],
  ])("names the %s behind a request that got no response", async (_label, cause, code, reason) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed", { cause });
      }),
    );

    const error = await getJSON("https://example.test/api/address/x/utxo?apikey=secret", {
      provider: "mempool",
    }).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(TransportError);
    expect(error).toMatchObject({ code, reason, provider: "mempool" });
    expect((error as Error).message).toBe(
      `No response from mempool (${reason}): https://example.test/api/address/x/utxo?apikey=REDACTED`,
    );
  });

  it("names a timeout behind a request that got no response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      }),
    );

    const error = await getJSON("https://example.test/data", { provider: "mempool" }).catch(
      (failure: unknown) => failure,
    );

    expect(error).toBeInstanceOf(TransportError);
    expect(error).toMatchObject({
      code: "TimeoutError",
      reason: "The operation was aborted due to timeout",
    });
  });

  it("keeps the URL but invents no status for a body that is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>", { headers: { "Content-Type": "text/html" } })),
    );

    const error = await getJSON("https://example.test/data", { provider: "mempool" }).catch(
      (failure: unknown) => failure,
    );

    expect(error).toBeInstanceOf(ExplorerError);
    expect(error).not.toBeInstanceOf(HTTPError);
    expect((error as Error).message).toContain("https://example.test/data");
    expect((error as Error).message).not.toContain("HTTP 0");
  });

  it.each([
    ["GET", () => getJSON<{ safe: number; large: string }>("https://example.test/data")],
    [
      "POST",
      () =>
        postJSON<{ safe: number; large: string }>("https://example.test/data", {
          query: "value",
        }),
    ],
  ])(
    "preserves integers beyond Number.MAX_SAFE_INTEGER in %s responses",
    async (_method, request) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response('{"safe":42,"large":123456789012345678901}', {
              headers: { "Content-Type": "application/json" },
            }),
        ),
      );

      await expect(request()).resolves.toEqual({
        safe: 42,
        large: "123456789012345678901",
      });
    },
  );
});
