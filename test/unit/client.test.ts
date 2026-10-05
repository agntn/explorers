import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  AuthError,
  ExplorerError,
  HTTPError,
  NotFoundError,
  RateLimitError,
  TransportError,
} from "../../src/core/errors.ts";
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

  /* Bodies the live services answered with, 2026-09-28. */
  it.each([
    ["Esplora", 400, "text/plain", "Too many unspent outputs", "Too many unspent outputs"],
    [
      "Horizon",
      400,
      "application/problem+json",
      JSON.stringify({
        type: "https://stellar.org/horizon-errors/bad_request",
        title: "Bad Request",
        status: 400,
        detail: "The request you sent was invalid in some way.",
        extras: {
          invalid_field: "limit",
          reason: "invalid limit: value provided that is over limit max of 200",
        },
      }),
      "invalid limit: value provided that is over limit max of 200",
    ],
    [
      "Blockscout",
      422,
      "application/json",
      JSON.stringify({
        errors: [
          {
            title: "Invalid value",
            source: { pointer: "/address_hash_param" },
            detail: "Invalid format. Expected ~r/^0x([A-Fa-f0-9]{40})$/",
          },
        ],
      }),
      "Invalid format. Expected ~r/^0x([A-Fa-f0-9]{40})$/",
    ],
    [
      "Koios",
      400,
      "application/json",
      JSON.stringify({
        code: "22P02",
        details: 'Array value must start with "{" or dimension information.',
        hint: null,
        message: 'malformed array literal: "x"',
      }),
      'malformed array literal: "x"',
    ],
    [
      "TONAPI",
      400,
      "application/json",
      JSON.stringify({ error: "can't decode address zz" }),
      "can't decode address zz",
    ],
  ])(
    "ends the message with the reason a %s error names",
    async (_service, status, type, body, reason) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(body, { status, headers: { "Content-Type": type } })),
      );

      const error = await getJSON("https://example.test/data", { provider: "test" }).catch(
        (cause: unknown) => cause,
      );

      expect(error).toBeInstanceOf(HTTPError);
      expect((error as Error).message).toBe(
        `HTTP ${status} from https://example.test/data: ${reason}`,
      );
    },
  );

  it.each([
    ["an HTML error page", "text/html", "<html><body><h1>502 Bad Gateway</h1></body></html>"],
    ["JSON without a reason field", "application/json", JSON.stringify({ status: 502 })],
    ["an empty body", "text/plain", ""],
  ])("keeps the bare status line for %s", async (_case, type, body) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { status: 502, headers: { "Content-Type": type } })),
    );

    const error = await getJSON("https://example.test/data", { provider: "test" }).catch(
      (cause: unknown) => cause,
    );

    expect(error).toBeInstanceOf(HTTPError);
    expect((error as Error).message).toBe("HTTP 502 from https://example.test/data");
  });

  it("quotes a long reason as one cut line", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(`first line\n${"x".repeat(400)}`, {
            status: 400,
            headers: { "Content-Type": "text/plain" },
          }),
      ),
    );

    const error = await getJSON("https://example.test/data", { provider: "test" }).catch(
      (cause: unknown) => cause,
    );
    const reason = (error as Error).message.split("data: ")[1] ?? "";

    expect(reason).toMatch(/^first line x+…$/);
    expect(reason).toHaveLength(200);
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

  it.each(["Network connection lost", "Failed to fetch"])(
    "reads %s with no code as a request that got no response",
    async (message) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new TypeError(message);
        }),
      );

      const error = await getJSON("https://example.test/data", { provider: "mempool" }).catch(
        (failure: unknown) => failure,
      );

      expect(error).toBeInstanceOf(TransportError);
      expect(error).toMatchObject({ reason: message, provider: "mempool" });
    },
  );

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

  it("still times out a request that carries a signal", async () => {
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            if (init?.signal) signals.push(init.signal);
            init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
              once: true,
            });
          }),
      ),
    );

    const error = await getJSON("https://example.test/data", {
      provider: "mempool",
      signal: new AbortController().signal,
      timeout: 20,
    }).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(TransportError);
    expect(error).toMatchObject({ code: "TimeoutError" });
    expect(signals[0]?.aborted).toBe(true);
  });

  it("stops a request when its signal aborts", async () => {
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            if (init?.signal) signals.push(init.signal);
            init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
              once: true,
            });
          }),
      ),
    );
    const controller = new AbortController();

    const request = getJSON("https://example.test/data", {
      provider: "mempool",
      signal: controller.signal,
    }).catch((failure: unknown) => failure);
    controller.abort();

    expect(await request).toMatchObject({ code: "AbortError", provider: "mempool" });
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
  it("sends a POST body as JSON with the Explorers headers", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetch);

    await postJSON("https://example.test/data", { query: "value" }, { headers: { "X-Key": "k" } });

    const init = fetch.mock.calls[0]?.[1];
    const headers = new Headers(init?.headers);
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe('{"query":"value"}');
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Accept")).toBe("application/json");
    expect(headers.get("User-Agent")).toMatch(/^explorers\//);
    expect(headers.get("X-Key")).toBe("k");
  });

  it("keeps a body JSON can't serialize inside the error hierarchy", async () => {
    const error = await postJSON(
      "https://example.test/data",
      { value: 1n },
      {
        provider: "koios",
      },
    ).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(ExplorerError);
    expect(error).toMatchObject({ provider: "koios" });
  });

  it.each([204, 205])("answers a %i response with nothing", async (status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status })),
    );

    await expect(getJSON("https://example.test/data")).resolves.toBeUndefined();
  });

  it("copies Retry-After from a 429 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response("slow down", { status: 429, headers: { "Retry-After": "30" } }),
      ),
    );

    const error = await getJSON("https://example.test/data", { provider: "mempool" }).catch(
      (failure: unknown) => failure,
    );

    expect(error).toBeInstanceOf(RateLimitError);
    expect(error).toMatchObject({ retryAfter: 30, provider: "mempool" });
  });

  it("reads a 401 response as a refused key without echoing it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("bad key", { status: 401 })),
    );

    const error = await getJSON("https://example.test/data?apikey=secret", {
      provider: "etherscan",
    }).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(AuthError);
    expect((error as Error).message).toBe(
      "Authentication failed for etherscan: HTTP 401 from https://example.test/data?apikey=REDACTED",
    );
  });

  it("keeps the server's reason when the key is the last query param", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Invalid address format", { status: 400 })),
    );

    const error = await getJSON("https://example.test/v2/api?module=account&apikey=secret", {
      provider: "etherscan",
    }).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(HTTPError);
    expect((error as Error).message).toBe(
      "HTTP 400 from https://example.test/v2/api?module=account&apikey=REDACTED: Invalid address format",
    );
  });

  it("times out a request that carries no signal of its own", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
              once: true,
            });
          }),
      ),
    );

    const error = await getJSON("https://example.test/data", {
      provider: "mempool",
      timeout: 20,
    }).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(TransportError);
    expect(error).toMatchObject({ code: "TimeoutError", provider: "mempool" });
  });
});
