/**
 * HTTP client wrapper for blocex providers
 */

import { ofetch } from 'ofetch'
import { normalizeError, HTTPError } from './errors.js'

export interface ClientOptions {
  timeout?: number
  headers?: Record<string, string>
}

export async function getJSON<T>(url: string, options?: ClientOptions): Promise<T> {
  try {
    return await ofetch<T>(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'blocex/0.1.0',
        ...options?.headers,
      },
      timeout: options?.timeout ?? 15_000,
    })
  }
  catch (error) {
    throw normalizeError(error)
  }
}

export async function getRaw(
  url: string,
  options?: ClientOptions,
): Promise<{ status: number; headers: Headers; body: string }> {
  try {
    const response = await ofetch.raw(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'blocex/0.1.0',
        ...options?.headers,
      },
      timeout: options?.timeout ?? 15_000,
      ignoreResponseError: true,
    })

    const body = await response.text()

    return {
      status: response.status,
      headers: response.headers,
      body,
    }
  }
  catch (error) {
    throw normalizeError(error)
  }
}

export async function postJSON<T>(url: string, body: unknown, options?: ClientOptions): Promise<T> {
  try {
    return await ofetch<T>(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'blocex/0.1.0',
        ...options?.headers,
      },
      body: JSON.stringify(body),
      timeout: options?.timeout ?? 15_000,
    })
  }
  catch (error) {
    throw normalizeError(error)
  }
}

export function buildQuery(params: Record<string, string | number | undefined>): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    }
  }
  return parts.length > 0 ? `?${parts.join('&')}` : ''
}
