/**
 * HTTP client wrapper for Explorers providers
 */

import { ofetch } from "ofetch";
import { normalizeError } from "./errors.js";
import { version } from "../version.js";

const USER_AGENT = `explorers/${version}`;

/** Request metadata shared by the HTTP helpers. */
export interface ClientOptions {
  timeout?: number;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  provider?: string;
}

/** Remove trailing separators before provider paths are appended. */
export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function parseJSON(text: string): unknown {
  type Reviver = (key: string, value: unknown, context: { source: string }) => unknown;
  const parseWithSource = JSON.parse as unknown as (value: string, reviver: Reviver) => unknown;

  return parseWithSource(text, (_key, value, context) => {
    if (
      typeof value === "number" &&
      !Number.isSafeInteger(value) &&
      /^-?\d+$/.test(context.source)
    ) {
      return context.source;
    }
    return value;
  });
}

/**
 * Fetch JSON with Explorers headers and a 15-second default timeout.
 *
 * Transport failures are normalized before they leave this boundary.
 */
export async function getJSON<T>(url: string, options?: ClientOptions): Promise<T> {
  try {
    return await ofetch<T>(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
        ...options?.headers,
      },
      timeout: options?.timeout ?? 15_000,
      signal: options?.signal,
      retry: false,
      parseResponse: parseJSON,
    });
  } catch (error) {
    throw normalizeError(error, options?.provider, url);
  }
}

export async function postJSON<T>(url: string, body: unknown, options?: ClientOptions): Promise<T> {
  try {
    return await ofetch<T>(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": USER_AGENT,
        ...options?.headers,
      },
      body: JSON.stringify(body),
      timeout: options?.timeout ?? 15_000,
      signal: options?.signal,
      retry: false,
      parseResponse: parseJSON,
    });
  } catch (error) {
    throw normalizeError(error, options?.provider, url);
  }
}

/**
 * Build a query string while dropping parameters whose value is `undefined`.
 *
 * @example
 * ```ts
 * buildQuery({ page: 2, cursor: undefined }) // '?page=2'
 * ```
 */
export function buildQuery(params: Record<string, string | number | undefined>): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) usp.set(key, String(value));
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
}
