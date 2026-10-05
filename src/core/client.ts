/** HTTP client wrapper for Explorers providers */

import { normalizeError, ResponseFailure } from "./errors.ts";
import { version } from "../version.ts";

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

interface Deadline {
  readonly signal: AbortSignal;
  readonly clear: () => void;
}

/**
 * Abort after `timeout`, body included, or on the caller's signal, on a timer fake timers can move.
 *
 * @param {ClientRequestOptions} options - Request metadata and cancellation.
 * @returns {Deadline} The signal for `fetch` and the call that disarms the timer.
 */
function deadline(options?: ClientRequestOptions): Deadline {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
  }, options?.timeout ?? 15_000);
  const signal =
    options?.signal === undefined
      ? controller.signal
      : AbortSignal.any([options.signal, controller.signal]);
  return { signal, clear: () => clearTimeout(timer) };
}

/* Statuses whose response carries no body by definition. */
const BODYLESS_STATUS_CODES: readonly number[] = [101, 204, 205, 304];

/**
 * Send one request and read the body as text, which `parseJSON` needs for its integer source.
 *
 * @param {string} url - The `url` value.
 * @param {RequestInit} init - Method, headers and body of the request.
 * @param {ClientRequestOptions} options - Request metadata and cancellation.
 * @returns {Promise<T>} The parsed body, `undefined` for a status without one.
 */
async function request<T>(
  url: string,
  init: RequestInit,
  options?: ClientRequestOptions,
): Promise<T> {
  const { signal, clear } = deadline(options);
  try {
    const response = await fetch(url, { ...init, signal });
    const text = BODYLESS_STATUS_CODES.includes(response.status)
      ? undefined
      : await response.text();
    if (response.status >= 400 && response.status < 600) {
      throw new ResponseFailure(response, text ?? "");
    }
    return parseJSON<T>(text);
  } catch (error) {
    throw normalizeError(error, options?.provider, url);
  } finally {
    clear();
  }
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
  return request<T>(
    url,
    {
      method: "GET",
      headers: { Accept: "application/json", "User-Agent": agent(), ...options?.headers },
    },
    options,
  );
}

export async function postJSON<T>(
  url: string,
  body: unknown,
  options?: ClientRequestOptions,
): Promise<T> {
  return request<T>(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": agent(),
        ...options?.headers,
      },
      body: JSON.stringify(body),
    },
    options,
  );
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
