import { describe, it, expect } from "vitest";
import {
  ExplorerError,
  HTTPError,
  AuthError,
  RateLimitError,
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
  it("AuthError", () => {
    const e = new AuthError("x402");
    expect(e).toBeInstanceOf(ExplorerError);
  });
  it("RateLimitError", () => {
    const e = new RateLimitError("x402", 60);
    expect(e.retryAfter).toBe(60);
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
