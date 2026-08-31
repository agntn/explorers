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

interface FailureContext {
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

function isTransportFailure(context: FailureContext): boolean {
  if (context.status > 0 || context.url !== undefined) return true;
  return ["econnrefused", "etimedout", "timeouterror"].some((fragment) =>
    context.lowerMessage.includes(fragment),
  );
}

function isNotFoundFailure(context: FailureContext): boolean {
  return context.status === 404 || context.lowerMessage.includes("not found");
}

function isRateLimitFailure(context: FailureContext): boolean {
  return context.status === 429 || context.lowerMessage.includes("rate limit");
}

function authenticationError(context: FailureContext): AuthError {
  const detail = context.url ? `HTTP ${context.status} from ${context.url}` : context.message;
  return new AuthError(context.provider ?? "unknown", detail);
}

function transportError(context: FailureContext): HTTPError {
  const body = context.fetchError ? getFetchErrorBody(context.fetchError) : undefined;
  return new HTTPError(
    context.status,
    context.url ?? "unknown",
    body ?? context.message,
    context.provider,
  );
}

function classifyFailure(context: FailureContext): ExplorerError | undefined {
  if (isNotFoundFailure(context)) return new NotFoundError(context.resource, context.provider);
  if (isRateLimitFailure(context)) return new RateLimitError(context.provider ?? "unknown");
  if (isAuthenticationFailure(context)) return authenticationError(context);
  return isTransportFailure(context) ? transportError(context) : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorStatus(error: FetchError | undefined, message: string): number {
  const statusMatch = message.match(/HTTP (\d{3})/i);
  return error?.statusCode ?? Number(statusMatch?.[1] ?? 0);
}

/**
 * Turn an unknown provider or transport failure into the Explorers error hierarchy.
 *
 * Existing `ExplorerError` instances pass through unchanged. Structured HTTP failures retain their
 * status, response body, and redacted request URL.
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
    fetchError,
    lowerMessage,
    message,
    provider,
    resource: url ?? message,
    status,
    url,
  };

  return classifyFailure(context) ?? new ExplorerError(message, provider);
}
