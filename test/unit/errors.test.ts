import { describe, it, expect } from "vite-plus/test";
import {
  ExplorerError,
  HTTPError,
  AuthError,
  RateLimitError,
  PlanRestrictedError,
  NotFoundError,
  UnsupportedChainError,
  UnsupportedOperationError,
  UnknownProviderError,
  TransportError,
  normalizeError,
} from "../../src/core/errors.ts";

/* The fields ofetch's `FetchError` carries, as a custom provider on ofetch would throw it. */
function fetchError(
  status: number,
  url: string,
  headers?: Readonly<Record<string, string>>,
): Error {
  return Object.assign(new Error(`[GET] "${url}": ${status}`), {
    name: "FetchError",
    statusCode: status,
    request: url,
    response: { status, headers: new Headers(headers) },
  });
}

describe("ExplorerError", () => {
  it("base", () => {
    const e = new ExplorerError("test", "x402");
    expect(e).toBeInstanceOf(Error);
  });
  it("HTTPError", () => {
    const e = new HTTPError(500, "https://api.example.com", "body", "x402");
    expect(e.statusCode).toBe(500);
  });
  it("HTTPError redacts hyphenated api-key query params", () => {
    const e = new HTTPError(500, "https://api.example.com/v0/txs?api-key=secret&limit=5");
    expect(e.message).toContain("api-key=REDACTED");
    expect(e.message).not.toContain("secret");
  });
  it("HTTPError keeps no unredacted key on rawUrl", () => {
    const e = new HTTPError(500, "https://x/v0/txs?api-key=secret&limit=5");
    expect(e.rawUrl).toContain("api-key=REDACTED");
    expect(e.rawUrl).not.toContain("secret");
  });
  it("HTTPError redacts keys in a server-echoed body", () => {
    const e = new HTTPError(500, "https://x", "echo of https://x?api-key=secret");
    expect(e.body).toContain("api-key=REDACTED");
    expect(e.body).not.toContain("secret");
  });
  it("normalizeError redacts keys in the fallback body", () => {
    const url = "https://api.example.com/v0/txs?api-key=secret&limit=5";
    const e = normalizeError(new Error(`HTTP 500 from ${url}`), "helius", url);
    expect(e).toBeInstanceOf(HTTPError);
    expect((e as HTTPError).body).not.toContain("secret");
    expect(e.message).not.toContain("secret");
    expect(e.message).toBe("HTTP 500 from https://api.example.com/v0/txs?api-key=REDACTED&limit=5");
  });
  it("HTTPError quotes a reason without terminal controls or line breaks", () => {
    const e = new HTTPError(
      400,
      "https://x",
      "\u001B[2J\u001B[31mbad\u001B[0m\r\nError: forged line",
    );
    expect(e.message).toBe("HTTP 400 from https://x: [2J[31mbad[0m Error: forged line");
  });
  it("HTTPError keeps the quoted reason apart from the URL", () => {
    const e = new HTTPError(
      400,
      "https://x?apikey=secret",
      "Too many unspent outputs",
      "blockstream",
    );
    expect(e.reason).toBe("Too many unspent outputs");
    expect(new HTTPError(502, "https://x", "<html>Bad gateway</html>").reason).toBeUndefined();
    const echoed = new HTTPError(400, "https://x", "Bad request to https://x?apikey=secret");
    expect(echoed.reason).toBe("Bad request to https://x?apikey=REDACTED");
  });
  it("HTTPError cuts a long reason between characters, not inside one", () => {
    const e = new HTTPError(400, "https://x", `${"a".repeat(198)}${"\u{1F600}".repeat(5)}`);
    expect(e.message).toBe(`HTTP 400 from https://x: ${"a".repeat(198)}\u{1F600}…`);
  });
  it("HTTPError keeps the reason after a key in the last query param", () => {
    const e = new HTTPError(400, "https://x/api?module=account&apikey=secret", "Invalid address");
    expect(e.message).toBe(
      "HTTP 400 from https://x/api?module=account&apikey=REDACTED: Invalid address",
    );
  });
  it("HTTPError keeps the reason after a key in a middle query param", () => {
    const e = new HTTPError(400, "https://x/api?apikey=secret&module=account", "Invalid address");
    expect(e.message).toBe(
      "HTTP 400 from https://x/api?apikey=REDACTED&module=account: Invalid address",
    );
  });
  it("HTTPError redacts a reason that echoes a URL with a trailing key", () => {
    const e = new HTTPError(
      400,
      "https://x?apikey=secret",
      "Bad request to https://x?apikey=secret",
    );
    expect(e.message).toBe(
      "HTTP 400 from https://x?apikey=REDACTED: Bad request to https://x?apikey=REDACTED",
    );
    expect(e.message).not.toContain("secret");
  });
  it("HTTPError redacts keys in a quoted reason", () => {
    const e = new HTTPError(400, "https://x", "Bad request to https://x?apikey=secret");
    expect(e.message).toBe("HTTP 400 from https://x: Bad request to https://x?apikey=REDACTED");
  });
  it("AuthError", () => {
    const e = new AuthError("x402");
    expect(e).toBeInstanceOf(ExplorerError);
  });
  it("RateLimitError", () => {
    const e = new RateLimitError("x402", 60);
    expect(e.retryAfter).toBe(60);
  });
  it("PlanRestrictedError", () => {
    const e = new PlanRestrictedError("etherscan", "Upgrade required");
    expect(e).toMatchObject({ name: "PlanRestrictedError", provider: "etherscan" });
    expect(e.message).toContain("Upgrade required");
  });
  it("NotFoundError", () => {
    const e = new NotFoundError("x402", "rid");
    expect(e).toBeInstanceOf(ExplorerError);
  });
  it("UnsupportedChainError", () => {
    const e = new UnsupportedChainError("x402", "solana");
    expect(e).toBeInstanceOf(ExplorerError);
  });
  it("UnsupportedOperationError", () => {
    const e = new UnsupportedOperationError("getBalance", "aptos");
    expect(e).toBeInstanceOf(ExplorerError);
    expect(e.message).toContain("getBalance");
  });
  it("UnknownProviderError", () => {
    const e = new UnknownProviderError("foo");
    expect(e).toBeInstanceOf(ExplorerError);
  });
});

describe("normalizeError", () => {
  it("passes through", () => {
    const e = new UnknownProviderError("foo");
    expect(normalizeError(e)).toBe(e);
  });
  it("wraps Error", () => {
    const out = normalizeError(new Error("oops"));
    expect(out).toBeInstanceOf(ExplorerError);
  });
  it("wraps non-Error", () => {
    const out = normalizeError("oops" as unknown);
    expect(out).toBeInstanceOf(ExplorerError);
  });
  it("names the transport reason when a request got no response", () => {
    const error = new Error("fetch failed");
    error.cause = new Error("connect ECONNREFUSED");
    const url = "https://mempool.space/api/address/x/utxo";

    const out = normalizeError(error, "mempool", url);

    expect(out).toBeInstanceOf(TransportError);
    expect(out).toMatchObject({ reason: "connect ECONNREFUSED", provider: "mempool" });
    expect(out.message).toBe(`No response from mempool (connect ECONNREFUSED): ${url}`);
    expect(JSON.stringify(out)).not.toContain("HTTP 0");
  });
  it("classifies a 404 response as not found", () => {
    expect(normalizeError(fetchError(404, "https://x.test"), "mempool")).toBeInstanceOf(
      NotFoundError,
    );
  });
  it("reads status, body and URL off an ofetch error from a custom provider", () => {
    const error = Object.assign(fetchError(500, "https://x.test/a"), {
      data: { message: "backend down" },
    });

    const out = normalizeError(error, "custom");

    expect(out).toBeInstanceOf(HTTPError);
    expect(out.message).toBe("HTTP 500 from https://x.test/a: backend down");
  });
  it("reads a 429 whose headers are a plain object as a rate limit without a wait", () => {
    const error = Object.assign(new Error("Too Many Requests"), {
      statusCode: 429,
      response: { headers: { "retry-after": "5" } },
    });

    const out = normalizeError(error, "custom");

    expect(out).toBeInstanceOf(RateLimitError);
    expect((out as RateLimitError).retryAfter).toBeUndefined();
  });
  it("reads an ofetch error without a response from a custom provider as no response", () => {
    const error = Object.assign(
      new Error('[GET] "https://x.test": <no response> Failed to fetch'),
      {
        name: "FetchError",
        cause: new TypeError("Failed to fetch"),
      },
    );

    const out = normalizeError(error, "custom");

    expect(out).toBeInstanceOf(TransportError);
    expect(out).toMatchObject({ reason: "Failed to fetch" });
  });
  it("reads retry-after off a 429 response", () => {
    const error = normalizeError(
      fetchError(429, "https://x.test", { "retry-after": "30" }),
      "mempool",
    );
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).retryAfter).toBe(30);
  });
});
