/** Explorers error hierarchy */

import { FetchError } from "ofetch";

/** Base class for failures surfaced through Explorers. */
export class ExplorerError extends Error {
  constructor(
    message: string,
    public readonly provider?: string,
  ) {
    super(message);
    this.name = "ExplorerError";
  }
}

/** Strip API keys from URLs for safe error messages */
function sanitizeUrl(url: string): string {
  return url
    .replace(/([?&])(apikey|apiKey|api_key|api-key|key)=([^&]*)/gi, "$1$2=REDACTED")
    .replace(/([?&])(secret|token)=([^&]*)/gi, "$1$2=REDACTED");
}

/** HTTP failure with a redacted request URL in its message. */
export class HTTPError extends ExplorerError {
  /** Original request URL. Deliberately non-enumerable to reduce accidental secret logging. */
  public readonly rawUrl: string;

  constructor(
    public readonly statusCode: number,
    url: string,
    public readonly body?: string,
    provider?: string,
  ) {
    const safeUrl = sanitizeUrl(url);
    super(`HTTP ${statusCode} from ${safeUrl}`, provider);
    this.rawUrl = url;
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
  return request === undefined ? undefined : String(request);
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

/**
 * Turn an unknown provider or transport failure into the Explorers error hierarchy.
 *
 * Existing `ExplorerError` instances pass through unchanged. Structured HTTP failures retain their
 * status, response body, and redacted request URL.
 */
export function normalizeError(
  error: unknown,
  provider?: string,
  requestUrl?: string,
): ExplorerError {
  if (error instanceof ExplorerError) return error;

  const message = error instanceof Error ? error.message : String(error);
  const lowerMessage = message.toLowerCase();
  const fetchError = error instanceof FetchError ? error : undefined;
  const statusMatch = message.match(/HTTP (\d{3})/i);
  const status = fetchError?.statusCode ?? Number(statusMatch?.[1] ?? 0);
  const url = requestUrl ?? (fetchError ? getFetchErrorUrl(fetchError) : undefined);
  const safeResource = url ? sanitizeUrl(url) : message;

  if (status === 404 || lowerMessage.includes("not found")) {
    return new NotFoundError(safeResource, provider);
  }

  if (status === 429 || lowerMessage.includes("rate limit")) {
    return new RateLimitError(provider ?? "unknown");
  }

  if (status === 401 || status === 403 || lowerMessage.includes("unauthorized")) {
    const detail = url ? `HTTP ${status} from ${sanitizeUrl(url)}` : message;
    return new AuthError(provider ?? "unknown", detail);
  }

  if (
    status > 0 ||
    url ||
    lowerMessage.includes("econnrefused") ||
    lowerMessage.includes("etimedout") ||
    lowerMessage.includes("timeouterror")
  ) {
    return new HTTPError(
      status,
      url ?? "unknown",
      (fetchError ? getFetchErrorBody(fetchError) : undefined) ?? message,
      provider,
    );
  }

  return new ExplorerError(message, provider);
}
