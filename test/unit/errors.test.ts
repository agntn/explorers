import { describe, it, expect } from "vitest";
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
  normalizeError,
} from "../../src/core/errors.js";

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
});
