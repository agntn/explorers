import { describe, it, expect } from "vitest";
import { assertSafePathSegment } from "../../src/core/path-safety.js";

describe("assertSafePathSegment", () => {
  it("accepts plain address-like strings", () => {
    expect(() => assertSafePathSegment("0xabc123", "address")).not.toThrow();
  });

  it("rejects empty", () => {
    expect(() => assertSafePathSegment("", "address")).toThrow(/empty/);
  });

  it("rejects whitespace-only", () => {
    expect(() => assertSafePathSegment("   ", "address")).toThrow(/empty/);
  });

  it("rejects bare `..` traversal", () => {
    expect(() => assertSafePathSegment("..", "address")).toThrow(/traversal/);
  });

  it("rejects `../` traversal (separator or traversal guard fires)", () => {
    expect(() => assertSafePathSegment("../admin", "address")).toThrow(/separator|traversal/);
  });

  it("rejects `..\\` (windows-style) traversal", () => {
    expect(() => assertSafePathSegment("..\\admin", "address")).toThrow(/separator|traversal/);
  });

  it("rejects literal `/`", () => {
    expect(() => assertSafePathSegment("foo/bar", "address")).toThrow(/separator/);
  });

  it("rejects literal `\\`", () => {
    expect(() => assertSafePathSegment("foo\\bar", "address")).toThrow(/separator/);
  });

  it("rejects URL-encoded `/`", () => {
    expect(() => assertSafePathSegment("foo%2Fbar", "address")).toThrow(/separator/);
  });

  it("rejects URL-encoded `..%2F`", () => {
    expect(() => assertSafePathSegment("..%2Fadmin", "address")).toThrow(/separator|traversal/);
  });

  it("rejects URL-encoded `\\`", () => {
    expect(() => assertSafePathSegment("foo%5Cbar", "address")).toThrow(/separator/);
  });

  it("rejects double-encoded `%252F` (becomes `/` after two decodes)", () => {
    expect(() => assertSafePathSegment("foo%252Fbar", "address")).toThrow(/separator/);
  });

  it("rejects NUL byte (control char injection)", () => {
    expect(() => assertSafePathSegment("foo\x00bar", "address")).toThrow(/separator|control/);
  });

  it("rejects `?` (query injection rewrites the request)", () => {
    expect(() => assertSafePathSegment("foo?api-key=evil", "address")).toThrow(/separator/);
  });

  it("rejects `#` (fragment cuts off appended query params)", () => {
    expect(() => assertSafePathSegment("foo#frag", "address")).toThrow(/separator/);
  });

  it("rejects URL-encoded `?`", () => {
    expect(() => assertSafePathSegment("foo%3Fbar", "address")).toThrow(/separator/);
  });

  it("rejects malformed percent-encoding", () => {
    expect(() => assertSafePathSegment("foo%E0%A4%A", "address")).toThrow(/percent-encoding/);
  });

  it("accepts hex digits without separators", () => {
    expect(() => assertSafePathSegment("0xabcdef0123456789", "address")).not.toThrow();
  });

  it("accepts base58-style strings (solana-style addresses)", () => {
    expect(() =>
      assertSafePathSegment("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", "address"),
    ).not.toThrow();
  });
});
