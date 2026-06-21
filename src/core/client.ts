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
  const usp = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) usp.set(key, String(value))
  }
  const s = usp.toString()
  return s ? `?${s}` : ''
}
