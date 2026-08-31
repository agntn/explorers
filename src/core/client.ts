/** HTTP client wrapper for Explorers providers */

import { ofetch } from "ofetch";
import { normalizeError } from "./errors.js";
import { version } from "../version.js";

let userAgent: string | undefined;

/* Built on the first request so that loading the client evaluates nothing. */
function agent(): string {
  userAgent ??= `explorers/${version}`;
  return userAgent;
}

/** Request metadata shared by the HTTP helpers. */
export interface ClientOptions {
  timeout?: number;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  provider?: string;
}

/** Immutable view consumed by one HTTP request without freezing the public options DTO. */
export interface ClientRequestOptions {
  readonly timeout?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
  readonly provider?: string;
}

/**
 * Remove trailing separators before provider paths are appended.
 *
 * @param {string} url - The `url` value.
 * @returns {string} The resulting value.
 */
export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function parseJSON<T>(text: string | undefined): T {
  if (text === undefined) return undefined as T;

  type Reviver = (key: string, value: unknown, context: Readonly<{ source: string }>) => unknown;
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
  }) as T;
}

/**
 * Fetch JSON with Explorers headers and a 15-second default timeout.
 *
 * Transport failures are normalized before they leave this boundary.
 *
 * @param {string} url - The `url` value.
 * @param {ClientRequestOptions} options - Request metadata and cancellation.
 * @returns {Promise<T>} The resulting value.
 */
export async function getJSON<T>(url: string, options?: ClientRequestOptions): Promise<T> {
  try {
    const response = await ofetch.raw<string, "text">(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": agent(),
        ...options?.headers,
      },
      timeout: options?.timeout ?? 15_000,
      signal: options?.signal,
      retry: false,
      responseType: "text",
    });
    return parseJSON<T>(response._data);
  } catch (error) {
    throw normalizeError(error, options?.provider, url);
  }
}

export async function postJSON<T>(
  url: string,
  body: unknown,
  options?: ClientRequestOptions,
): Promise<T> {
  try {
    const response = await ofetch.raw<string, "text">(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": agent(),
        ...options?.headers,
      },
      body: JSON.stringify(body),
      timeout: options?.timeout ?? 15_000,
      signal: options?.signal,
      retry: false,
      responseType: "text",
    });
    return parseJSON<T>(response._data);
  } catch (error) {
    throw normalizeError(error, options?.provider, url);
  }
}

/**
 * Build a query string while dropping parameters whose value is `undefined`.
 *
 * @example
 *   ```ts
 *   buildQuery({ page: 2, cursor: undefined }); // '?page=2'
 *   ```
 *
 * @param {Readonly<Record<string, string | number | undefined>>} params - The `params` value.
 * @returns {string} The resulting value.
 */
export function buildQuery(params: Readonly<Record<string, string | number | undefined>>): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) usp.set(key, String(value));
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
}
