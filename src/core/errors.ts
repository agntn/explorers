/** Explorers error hierarchy */

/**
 * Base class for failures surfaced through Explorers.
 *
 * Every message passes through `sanitizeUrl` here, so secret query params are redacted at one
 * boundary instead of at each construction site.
 */
export class ExplorerError extends Error {
  public readonly provider?: string | undefined;

  constructor(message: string, provider?: string) {
    super(sanitizeUrl(message));
    this.provider = provider;
    this.name = "ExplorerError";
  }
}

/* Strip API keys from URLs and URL-bearing text for safe error messages */
function sanitizeUrl(url: string): string {
  return url.replaceAll(/([?&])(api[-_]?key|key|secret|token)=[^&#]*/gi, "$1$2=REDACTED");
}

/** Longest server reason an `HTTPError` message quotes before cutting it. */
const REASON_LIMIT = 200;

/**
 * Control bytes a terminal would obey. The reason is text a server chose, and the CLI, Pi and OMP
 * print an error message without the filter their result lines pass through.
 */
// oxlint-disable-next-line no-control-regex -- These bytes are precisely what the reason drops.
const REASON_CONTROLS = /[\u0000-\u001F\u007F-\u009F]/gu;

/**
 * JSON fields that carry a server's reason, most specific first, so Horizon's `extras.reason` wins
 * over its generic `detail` and Blockscout's `errors[0].detail` over its `title`.
 */
const REASON_FIELDS = ["reason", "detail", "message", "error", "title"] as const;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/* The body object and the objects one level below it, a list contributing its first entry. */
function reasonNodes(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>>[] {
  const nested = Object.values(value).map((child): unknown =>
    Array.isArray(child) ? (child as readonly unknown[])[0] : child,
  );
  return [value, ...nested.filter(isRecord)];
}

function jsonReason(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return undefined;
  const nodes = reasonNodes(value);
  for (const field of REASON_FIELDS) {
    for (const node of nodes) {
      const reason = node[field];
      if (typeof reason === "string" && reason.trim() !== "") return reason;
    }
  }
  return undefined;
}

/**
 * Read the reason a server gave for a failed request: a plain-text body, or the first reason field
 * of a JSON body. HTML error pages and JSON without such a field give none.
 *
 * @param {string} body - Response body as text.
 * @returns {string | undefined} One line of at most `REASON_LIMIT` characters.
 */
function responseReason(body: string | undefined): string | undefined {
  const text = body?.trim();
  if (!text || text.startsWith("<")) return undefined;
  let reason: string | undefined;
  try {
    reason = jsonReason(JSON.parse(text));
  } catch {
    reason = text;
  }
  const line = reason?.replaceAll(/\s+/g, " ").replaceAll(REASON_CONTROLS, "").trim();
  if (!line) return undefined;
  const characters = Array.from(line);
  if (characters.length <= REASON_LIMIT) return line;
  return `${characters.slice(0, REASON_LIMIT - 1).join("")}…`;
}

/**
 * HTTP failure with a redacted request URL in its message and a redacted response body.
 *
 * The message ends with the reason the server gave, when the body names one, so every surface that
 * shows only the message still says why the request failed.
 */
export class HTTPError extends ExplorerError {
  public readonly statusCode: number;

  /**
   * Request URL with secret query params redacted. Non-enumerable to keep serialized errors
   * compact.
   */
  public readonly rawUrl: string;

  /** Response body, redacted in case the server echoes the request URL. */
  public readonly body?: string;

  /** The reason the message ends with, for a surface that shows it without the URL. */
  public readonly reason?: string | undefined;

  constructor(statusCode: number, url: string, body?: string, provider?: string) {
    const status = `HTTP ${statusCode} from ${url}`;
    const reason = responseReason(body);
    const quoted = reason === undefined || reason === status ? undefined : reason;
    super(quoted === undefined ? status : `${status}: ${quoted}`, provider);
    this.statusCode = statusCode;
    if (quoted !== undefined) this.reason = sanitizeUrl(quoted);
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
  public readonly reason: string;
  public readonly code?: string | undefined;

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
  constructor(reason: string, url?: string, code?: string, provider?: string) {
    const source = provider === undefined ? "" : ` from ${provider}`;
    super(`No response${source} (${reason})${url === undefined ? "" : `: ${url}`}`, provider);
    this.code = code;
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
  public readonly retryAfter?: number | undefined;

  /**
   * @param {string} provider - Provider that refused the request.
   * @param {number} retryAfter - Seconds the provider asked to wait, from `Retry-After`.
   * @param {string} detail - The provider's own reason, such as an IP block.
   */
  constructor(provider: string, retryAfter?: number, detail?: string) {
    super(
      `Rate limited by ${provider}${retryAfter ? ` (retry after ${retryAfter}s)` : ""}${detail ? `: ${detail}` : ""}`,
      provider,
    );
    this.retryAfter = retryAfter;
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
  public readonly chain: string;

  constructor(chain: string, provider: string) {
    super(`Chain "${chain}" not supported by ${provider}`, provider);
    this.chain = chain;
    this.name = "UnsupportedChainError";
  }
}

/** Explorer backend does not expose the requested operation. */
export class UnsupportedOperationError extends ExplorerError {
  public readonly operation: string;

  constructor(operation: string, provider: string) {
    super(`Operation "${operation}" not supported by ${provider}`, provider);
    this.operation = operation;
    this.name = "UnsupportedOperationError";
  }
}

/** Address format belongs to a different chain family than the one requested, so no request was sent. */
export class AddressChainMismatchError extends ExplorerError {
  public readonly address: string;
  public readonly chain: string;
  public readonly matches: readonly string[];

  constructor(address: string, chain: string, matches: readonly string[]) {
    const listed =
      matches.length > 3
        ? `${matches.slice(0, 3).join(", ")} and ${matches.length - 3} more`
        : matches.join(", ");
    super(`Address ${address} is not valid on ${chain}; its format matches ${listed}`);
    this.address = address;
    this.chain = chain;
    this.matches = matches;
    this.name = "AddressChainMismatchError";
  }
}

/** Registry does not contain the requested provider name. The message lists the names it does hold. */
export class UnknownProviderError extends ExplorerError {
  constructor(provider: string, known: readonly string[] = []) {
    const listed = known.length === 0 ? "" : `; known providers: ${known.join(", ")}`;
    super(`Unknown provider: ${provider}${listed}`, provider);
    this.name = "UnknownProviderError";
  }
}
/** An error status on its way into {@link normalizeError}, shaped like ofetch's `FetchError`. */
export class ResponseFailure extends Error {
  public readonly statusCode: number;
  public readonly data: string;
  public readonly response: Response;

  constructor(response: Response, body: string) {
    super(`${response.status} ${response.statusText}`);
    this.name = "ResponseFailure";
    this.statusCode = response.status;
    this.data = body;
    this.response = response;
  }
}

/** A request that never got its whole answer, whatever the runtime called the cause. */
export class NoResponse extends Error {
  constructor(cause: unknown) {
    super("no response", { cause });
    this.name = "NoResponse";
  }
}

/** What {@link normalizeError} reads off an error that came with a response. */
interface ResponseLike {
  readonly statusCode: number;
  readonly data?: unknown;
  readonly request?: unknown;
  readonly response?: Readonly<{ headers?: unknown }>;
}

function responseLike(error: unknown): ResponseLike | undefined {
  if (!(error instanceof Error) || !("statusCode" in error)) return undefined;
  return typeof error.statusCode === "number" ? (error as ResponseLike) : undefined;
}

/* ofetch wraps a failed request in a `FetchError` without a status. */
function isOfetchError(error: unknown): boolean {
  return error instanceof Error && error.name === "FetchError";
}

function responseUrl(failure: ResponseLike): string | undefined {
  const { request } = failure;
  if (typeof request === "string") return request;
  if (request instanceof URL) return request.href;
  if (typeof Request !== "undefined" && request instanceof Request) return request.url;
  return undefined;
}

function responseBody(failure: ResponseLike): string | undefined {
  if (typeof failure.data === "string") return failure.data;
  if (failure.data === undefined) return undefined;
  try {
    return JSON.stringify(failure.data);
  } catch {
    return undefined;
  }
}

interface TransportCause {
  readonly code?: string;
  readonly reason: string;
}

interface FailureContext {
  readonly cause: TransportCause;
  readonly failure?: ResponseLike;
  readonly noResponse: boolean;
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

/* A request that never got a response has no status. */
function isTransportFailure(context: FailureContext): boolean {
  if (context.status > 0) return false;
  if (context.noResponse) return true;
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

function retryAfterSeconds(failure: ResponseLike | undefined): number | undefined {
  const headers = failure?.response?.headers;
  const header = headers instanceof Headers ? headers.get("retry-after") : null;
  if (header === null) return undefined;
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
  const body = context.failure ? responseBody(context.failure) : undefined;
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
    return new RateLimitError(context.provider ?? "unknown", retryAfterSeconds(context.failure));
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
    if (current.message !== "" && current.name !== "FetchError") reason = current.message;
    code = errorCode(current) ?? code;
    current = current.cause ?? (current instanceof AggregateError ? current.errors[0] : undefined);
  }
  return { code, reason };
}

function errorStatus(failure: ResponseLike | undefined, message: string): number {
  const statusMatch = message.match(/HTTP (\d{3})/i);
  return failure?.statusCode ?? Number(statusMatch?.[1] ?? 0);
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
  const failure = responseLike(error);
  const noResponse = error instanceof NoResponse || (failure === undefined && isOfetchError(error));
  const status = errorStatus(failure, message);
  const url = requestUrl ?? (failure ? responseUrl(failure) : undefined);
  const context: FailureContext = {
    cause: transportCause(error),
    failure,
    lowerMessage,
    noResponse,
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
