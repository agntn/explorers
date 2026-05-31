/**
 * blocex error hierarchy
 */

export class BlocexError extends Error {
  constructor(message: string, public readonly provider?: string) {
    super(message)
    this.name = 'BlocexError'
  }
}

/** Strip API keys from URLs for safe error messages */
function sanitizeUrl(url: string): string {
  return url
    .replace(/([?&])(apikey|apiKey|api_key|key)=([^&]*)/gi, '$1$2=REDACTED')
    .replace(/([?&])(secret|token)=([^&]*)/gi, '$1$2=REDACTED')
}

export class HTTPError extends BlocexError {
  /** Raw URL (may contain API key — use with care) */
  public readonly rawUrl: string

  constructor(
    public readonly statusCode: number,
    url: string,
    public readonly body?: string,
    provider?: string,
  ) {
    const safeUrl = sanitizeUrl(url)
    super(`HTTP ${statusCode} from ${safeUrl}`, provider)
    this.rawUrl = url
    this.name = 'HTTPError'
  }
}

export class AuthError extends BlocexError {
  constructor(provider: string, detail?: string) {
    super(`Authentication failed for ${provider}${detail ? `: ${detail}` : ''}`, provider)
    this.name = 'AuthError'
  }
}

export class RateLimitError extends BlocexError {
  constructor(
    provider: string,
    public readonly retryAfter?: number,
  ) {
    super(`Rate limited by ${provider}${retryAfter ? ` (retry after ${retryAfter}s)` : ''}`, provider)
    this.name = 'RateLimitError'
  }
}

export class NotFoundError extends BlocexError {
  constructor(resource: string, provider?: string) {
    super(`Not found: ${resource}`, provider)
    this.name = 'NotFoundError'
  }
}

export class UnsupportedChainError extends BlocexError {
  constructor(chain: string, provider: string) {
    super(`Chain "${chain}" not supported by ${provider}`, provider)
    this.name = 'UnsupportedChainError'
  }
}

export class UnknownProviderError extends BlocexError {
  constructor(provider: string) {
    super(`Unknown provider: ${provider}`, provider)
    this.name = 'UnknownProviderError'
  }
}

export function normalizeError(error: unknown, provider?: string): BlocexError {
  if (error instanceof BlocexError) return error

  const msg = error instanceof Error ? error.message : String(error)

  if (msg.includes('ECONNREFUSED') || msg.includes('ETIMEDOUT')) {
    return new HTTPError(0, 'unknown', msg, provider)
  }

  const statusMatch = msg.match(/HTTP (\d{3})/)
  const status = statusMatch ? Number(statusMatch[1]) : 0

  if (status === 404 || msg.includes('not found')) {
    return new NotFoundError(msg, provider)
  }

  if (status === 429 || msg.includes('429') || msg.includes('rate limit')) {
    return new RateLimitError(provider ?? 'unknown')
  }

  if (status === 401 || status === 403 || msg.includes('unauthorized')) {
    return new AuthError(provider ?? 'unknown', msg)
  }

  return new BlocexError(msg, provider)
}
