/** Explorers error hierarchy */

import { FetchError } from "ofetch";

/**
 * Base class for failures surfaced through Explorers.
 *
 * Every message passes through `sanitizeUrl` here, so secret query params are redacted at one
 * boundary instead of at each construction site.
 */
export class ExplorerError extends Error {
  constructor(
    message: string,
    public readonly provider?: string,
  ) {
    super(sanitizeUrl(message));
    this.name = "ExplorerError";
  }
}

/* Strip API keys from URLs and URL-bearing text for safe error messages */
function sanitizeUrl(url: string): string {
  return url.replaceAll(/([?&])(api[-_]?key|key|secret|token)=[^&#]*/gi, "$1$2=REDACTED");
}

/** HTTP failure with a redacted request URL in its message and a redacted response body. */
export class HTTPError extends ExplorerError {
  /**
   * Request URL with secret query params redacted. Non-enumerable to keep serialized errors
   * compact.
   */
  public readonly rawUrl: string;

  /** Response body, redacted in case the server echoes the request URL. */
  public readonly body?: string;

  constructor(
    public readonly statusCode: number,
    url: string,
    body?: string,
    provider?: string,
  ) {
    super(`HTTP ${statusCode} from ${url}`, provider);
    if (body !== undefined) this.body = sanitizeUrl(body);
    this.rawUrl = sanitizeUrl(url);
    Object.defineProperty(this, "rawUrl", { enumerable: false });
    this.name = "HTTPError";
  }
}

/**
 * Request that ended before any HTTP response arrived: a refused connection, an unresolved host, a
 * reset socket, a timeout or an abort.
 */
export class TransportError extends ExplorerError {
  /**
   * Request URL with secret query params redacted. Non-enumerable to keep serialized errors
   * compact.
   */
  public readonly rawUrl?: string;

  /**
   * @param {string} reason - Message of the innermost cause, such as `connect ECONNREFUSED`.
   * @param {string} url - Request URL, when known.
   * @param {string} code - System error code or DOMException name, such as `ENOTFOUND` or
   *   `TimeoutError`.
   * @param {string} provider - Provider that sent the request.
   */
  constructor(
    public readonly reason: string,
    url?: string,
    public readonly code?: string,
    provider?: string,
  ) {
    const source = provider === undefined ? "" : ` from ${provider}`;
    super(`No response${source} (${reason})${url === undefined ? "" : `: ${url}`}`, provider);
    this.reason = sanitizeUrl(reason);
    if (url !== undefined) {
      this.rawUrl = sanitizeUrl(url);
      Object.defineProperty(this, "rawUrl", { enumerable: false });
    }
    this.name = "TransportError";
  }
}

/** Provider credentials were missing or rejected. */
export class AuthError extends ExplorerError {
  constructor(provider: string, detail?: string) {
    super(`Authentication failed for ${provider}${detail ? `: ${detail}` : ""}`, provider);
    this.name = "AuthError";
  }
}

/** Provider refused a request because its rate limit was reached. */
export class RateLimitError extends ExplorerError {
  constructor(
    provider: string,
    public readonly retryAfter?: number,
  ) {
    super(
      `Rate limited by ${provider}${retryAfter ? ` (retry after ${retryAfter}s)` : ""}`,
      provider,
    );
    this.name = "RateLimitError";
  }
}

/** Provider credentials are valid, but the current plan does not cover the requested read. */
export class PlanRestrictedError extends ExplorerError {
  constructor(provider: string, detail?: string) {
    super(`Plan restricted by ${provider}${detail ? `: ${detail}` : ""}`, provider);
    this.name = "PlanRestrictedError";
  }
}

/** Requested transaction, address, contract, or block was not found. */
export class NotFoundError extends ExplorerError {
  constructor(resource: string, provider?: string) {
    super(`Not found: ${resource}`, provider);
    this.name = "NotFoundError";
  }
}

/** Provider does not serve the requested chain. */
export class UnsupportedChainError extends ExplorerError {
  constructor(chain: string, provider: string) {
    super(`Chain "${chain}" not supported by ${provider}`, provider);
    this.name = "UnsupportedChainError";
  }
}

/** Explorer backend does not expose the requested operation. */
export class UnsupportedOperationError extends ExplorerError {
  constructor(operation: string, provider: string) {
    super(`Operation "${operation}" not supported by ${provider}`, provider);
    this.name = "UnsupportedOperationError";
  }
}

/** Address format belongs to a different chain family than the one requested, so no request was sent. */
export class AddressChainMismatchError extends ExplorerError {
  constructor(
    public readonly address: string,
    public readonly chain: string,
    public readonly matches: readonly string[],
  ) {
    const listed =
      matches.length > 3
        ? `${matches.slice(0, 3).join(", ")} and ${matches.length - 3} more`
        : matches.join(", ");
    super(`Address ${address} is not valid on ${chain}; its format matches ${listed}`);
    this.name = "AddressChainMismatchError";
  }
}

/** Registry does not contain the requested provider name. */
export class UnknownProviderError extends ExplorerError {
  constructor(provider: string) {
    super(`Unknown provider: ${provider}`, provider);
    this.name = "UnknownProviderError";
  }
}
function getFetchErrorUrl(error: FetchError): string | undefined {
  const request = error.request;
  if (typeof request === "string") return request;
  if (request instanceof URL) return request.href;
  if (typeof Request !== "undefined" && request instanceof Request) return request.url;
  return undefined;
}

function getFetchErrorBody(error: FetchError): string | undefined {
  if (typeof error.data === "string") return error.data;
  if (error.data === undefined) return undefined;
  try {
    return JSON.stringify(error.data);
  } catch {
    return String(error.data);
  }
}

interface TransportCause {
  readonly code?: string;
  readonly reason: string;
}

interface FailureContext {
  readonly cause: TransportCause;
  readonly fetchError?: FetchError;
  readonly lowerMessage: string;
  readonly message: string;
  readonly provider?: string;
  readonly resource: string;
  readonly status: number;
  readonly url?: string;
}

function isAuthenticationFailure(context: FailureContext): boolean {
  return (
    context.status === 401 ||
    context.status === 403 ||
    context.lowerMessage.includes("unauthorized")
  );
}

/* A request that never got a response has no status and, from ofetch, no response object. */
function isTransportFailure(context: FailureContext): boolean {
  if (context.status > 0) return false;
  if (context.fetchError) return context.fetchError.response === undefined;
  if (context.cause.code !== undefined) return true;
  const text = `${context.lowerMessage} ${context.cause.reason.toLowerCase()}`;
  return [
    "fetch failed",
    "econnrefused",
    "econnreset",
    "enotfound",
    "eai_again",
    "etimedout",
    "timeouterror",
  ].some((fragment) => text.includes(fragment));
}

function isNotFoundFailure(context: FailureContext): boolean {
  return context.status === 404 || context.lowerMessage.includes("not found");
}

function isRateLimitFailure(context: FailureContext): boolean {
  return context.status === 429 || context.lowerMessage.includes("rate limit");
}

function retryAfterSeconds(error: FetchError | undefined): number | undefined {
  const header = error?.response?.headers?.get("retry-after");
  if (header === null || header === undefined) return undefined;
  const trimmed = header.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function authenticationError(context: FailureContext): AuthError {
  const detail =
    context.url && context.status > 0
      ? `HTTP ${context.status} from ${context.url}`
      : context.message;
  return new AuthError(context.provider ?? "unknown", detail);
}

function httpError(context: FailureContext): HTTPError {
  const body = context.fetchError ? getFetchErrorBody(context.fetchError) : undefined;
  return new HTTPError(
    context.status,
    context.url ?? "unknown",
    body ?? context.message,
    context.provider,
  );
}

function classifyFailure(context: FailureContext): ExplorerError | undefined {
  if (isTransportFailure(context)) {
    return new TransportError(
      context.cause.reason,
      context.url,
      context.cause.code,
      context.provider,
    );
  }
  if (isNotFoundFailure(context)) return new NotFoundError(context.resource, context.provider);
  if (isRateLimitFailure(context)) {
    return new RateLimitError(context.provider ?? "unknown", retryAfterSeconds(context.fetchError));
  }
  if (isAuthenticationFailure(context)) return authenticationError(context);
  return context.status > 0 ? httpError(context) : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: Readonly<Error>): string | undefined {
  const code: unknown = (error as { code?: unknown }).code;
  if (typeof code === "string") return code;
  return error.name === "TimeoutError" || error.name === "AbortError" ? error.name : undefined;
}

/**
 * Follow `cause` links, and the first entry of an `AggregateError`, down to the error that names
 * the reason. The deepest message with text and the deepest code win; the ofetch wrapper only
 * repeats the URL, so its own message is used only when nothing deeper has one.
 *
 * @param {unknown} error - The failure thrown by the request.
 * @returns {TransportCause} Reason and code to report.
 */
function transportCause(error: unknown): TransportCause {
  let reason = errorMessage(error);
  let code: string | undefined;
  let current: unknown = error;
  for (let depth = 0; current instanceof Error && depth < 8; depth += 1) {
    if (current.message !== "" && !(current instanceof FetchError)) reason = current.message;
    code = errorCode(current) ?? code;
    current = current.cause ?? (current instanceof AggregateError ? current.errors[0] : undefined);
  }
  return { code, reason };
}

function errorStatus(error: FetchError | undefined, message: string): number {
  const statusMatch = message.match(/HTTP (\d{3})/i);
  return error?.statusCode ?? Number(statusMatch?.[1] ?? 0);
}

/**
 * Turn an unknown provider or transport failure into the Explorers error hierarchy.
 *
 * Existing `ExplorerError` instances pass through unchanged. Structured HTTP failures retain their
 * status, response body, and redacted request URL. A request that got no response becomes a
 * `TransportError` carrying the reason and code of its innermost cause.
 *
 * @param {unknown} error - The `error` value.
 * @param {string} provider - The `provider` value.
 * @param {string} requestUrl - The `requestUrl` value.
 * @returns {ExplorerError} The resulting value.
 */
export function normalizeError(
  error: unknown,
  provider?: string,
  requestUrl?: string,
): ExplorerError {
  if (error instanceof ExplorerError) return error;

  const message = errorMessage(error);
  const lowerMessage = message.toLowerCase();
  const fetchError = error instanceof FetchError ? error : undefined;
  const status = errorStatus(fetchError, message);
  const fetchUrl = fetchError ? getFetchErrorUrl(fetchError) : undefined;
  const url = requestUrl ?? fetchUrl;
  const context: FailureContext = {
    cause: transportCause(error),
    fetchError,
    lowerMessage,
    message,
    provider,
    resource: url ?? message,
    status,
    url,
  };

  const known = classifyFailure(context);
  if (known) return known;
  return new ExplorerError(url === undefined ? message : `${message}: ${url}`, provider);
}
