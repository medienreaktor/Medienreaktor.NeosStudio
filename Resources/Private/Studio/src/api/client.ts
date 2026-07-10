import { config } from '@/config'
import { getTokens } from '@/auth/oauth'

export interface ApiResult {
  status: number
  ok: boolean
  durationMs: number
  body: unknown
  raw: string
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`API request failed with status ${status}`)
    this.name = 'ApiError'
  }
}

function buildUrl(path: string): string {
  // Allow both absolute-ish "/api/..." paths and bare "sites" shortcuts
  return path.startsWith('http')
    ? path
    : config.apiBase + (path.startsWith('/') ? path.replace(/^\/api/, '') : '/' + path)
}

function buildHeaders(hasBody: boolean): Record<string, string> {
  const headers: Record<string, string> = {}
  const tokens = getTokens()
  if (tokens) headers['Authorization'] = `Bearer ${tokens.access_token}`
  if (hasBody) headers['Content-Type'] = 'application/json'
  return headers
}

/**
 * Free-form request preserving status, timing and raw body. Used by the
 * debugging console, which renders non-2xx responses as inspectable results
 * rather than errors.
 */
export async function rawRequest(method: string, path: string, body?: string): Promise<ApiResult> {
  const started = performance.now()
  const response = await fetch(buildUrl(path), {
    method,
    headers: buildHeaders(Boolean(body) && method !== 'GET'),
    body: method === 'GET' ? undefined : body,
  })
  const raw = await response.text()
  const durationMs = Math.round(performance.now() - started)

  let parsed: unknown = raw
  try {
    parsed = JSON.parse(raw)
  } catch {
    /* keep raw text */
  }

  return { status: response.status, ok: response.ok, durationMs, body: parsed, raw }
}

/**
 * Typed request for query/mutation hooks: resolves with the parsed body on
 * 2xx and throws ApiError otherwise, so TanStack Query sees proper error
 * states (and the retry logic can distinguish 4xx from 5xx).
 */
export async function apiFetch<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const method = init?.method ?? 'GET'
  const body = init?.body !== undefined ? JSON.stringify(init.body) : undefined
  const result = await rawRequest(method, path, body)
  if (!result.ok) throw new ApiError(result.status, result.body)
  return result.body as T
}
