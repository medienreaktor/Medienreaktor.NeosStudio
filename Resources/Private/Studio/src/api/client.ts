import { config } from '@/config'
import { getTokens } from '@/auth/oauth'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`API request failed with status ${status}`)
    this.name = 'ApiError'
  }
}

/**
 * Typed request for query/mutation hooks: resolves with the parsed body on
 * 2xx and throws ApiError otherwise, so TanStack Query sees proper error
 * states (and the retry logic can distinguish 4xx from 5xx).
 */
export async function apiFetch<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const method = init?.method ?? 'GET'
  const body = init?.body !== undefined ? JSON.stringify(init.body) : undefined

  const headers: Record<string, string> = {}
  const tokens = getTokens()
  if (tokens) headers['Authorization'] = `Bearer ${tokens.access_token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const response = await fetch(config.apiBase + path, { method, headers, body })
  const raw = await response.text()

  let parsed: unknown = raw
  try {
    parsed = JSON.parse(raw)
  } catch {
    /* keep raw text */
  }

  if (!response.ok) throw new ApiError(response.status, parsed)
  return parsed as T
}
