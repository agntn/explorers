import { ExplorerError } from "./errors.js";

function decodePathSegment(value: string, label: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw new ExplorerError(`${label} contains malformed percent-encoding`);
  }

  try {
    return decodeURIComponent(decoded);
  } catch {
    return decoded;
  }
}

function hasPathTraversal(value: string): boolean {
  return value === ".." || value === "." || value.includes("../") || value.includes("..\\");
}

/**
 * Validate a string is safe to interpolate into a URL path segment.
 *
 * Rejects empty values, traversal, separators, delimiters, encoded separators, and control bytes.
 * Use this for values interpolated into URL paths, not query parameters.
 *
 * @param {string} value - Candidate path segment.
 * @param {string} label - Human-readable field name used in failures.
 * @throws {ExplorerError} When the input is unsafe.
 */
export function assertSafePathSegment(value: string, label = "value"): void {
  if (typeof value !== "string") throw new ExplorerError(`${label} must be a string`);
  if (value.length === 0 || /^\s*$/.test(value)) throw new ExplorerError(`${label} is empty`);

  const decoded = decodePathSegment(value, label);
  // oxlint-disable-next-line no-control-regex -- Control chars are precisely what this boundary rejects.
  if (/[/\x00-\x1F\\?#]/.test(decoded)) {
    throw new ExplorerError(`${label} contains path separator or control char`);
  }
  if (hasPathTraversal(decoded)) {
    throw new ExplorerError(`${label} contains path traversal sequence`);
  }
}
