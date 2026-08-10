import { ExplorerError } from "./errors.js";

/**
 * Validate a string is safe to interpolate into a URL path segment.
 *
 * Rejects:
 *   - empty / whitespace-only inputs
 *   - path traversal sequences (`..`, `.`)
 *   - path separators (`/`, `\`)
 *   - URL-encoded separators and control characters
 *   - control characters / NUL bytes
 *
 * Use for `address`, `hash`, `txhash`, `account`, `blockHeight`-style params
 * that go into URL paths. NOT for query params (use encodeURIComponent instead).
 *
 * @throws {ExplorerError} when the input is unsafe.
 */
export function assertSafePathSegment(value: string, label = "value"): void {
  if (typeof value !== "string") {
    throw new ExplorerError(`${label} must be a string`);
  }
  if (value.length === 0 || /^\s*$/.test(value)) {
    throw new ExplorerError(`${label} is empty`);
  }
  // Reject URL-encoded variants of separators/dots before checking the raw
  // string — otherwise `%2F` looks safe and slips through.
  // The decodeURIComponent can throw on malformed sequences; treat as unsafe.
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw new ExplorerError(`${label} contains malformed percent-encoding`);
  }
  // After one round of decoding, repeat on the result so double-encoded
  // payloads (`%252F`) don't bypass.
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    /* second pass failed — that's fine, the first decode already ran */
  }

  // oxlint-disable-next-line no-control-regex -- Control chars are precisely what this boundary rejects.
  if (/[/\x00-\x1f\\]/.test(decoded)) {
    throw new ExplorerError(`${label} contains path separator or control char`);
  }
  // Reject `..` (any segment traversal) and bare `.`
  if (decoded === ".." || decoded === "." || decoded.includes("../") || decoded.includes("..\\")) {
    throw new ExplorerError(`${label} contains path traversal sequence`);
  }
}
