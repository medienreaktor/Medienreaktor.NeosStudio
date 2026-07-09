import { config } from './config'
import { getTokens } from './auth'

export interface ApiResult {
  status: number
  ok: boolean
  durationMs: number
  body: unknown
  raw: string
}

export async function apiRequest(method: string, path: string, body?: string): Promise<ApiResult> {
  const tokens = getTokens()
  const headers: Record<string, string> = {}
  if (tokens) headers['Authorization'] = `Bearer ${tokens.access_token}`
  if (body && method !== 'GET') headers['Content-Type'] = 'application/json'

  // Allow both absolute-ish "/api/..." paths and bare "sites" shortcuts
  const url = path.startsWith('http')
    ? path
    : config.apiBase + (path.startsWith('/') ? path.replace(/^\/api/, '') : '/' + path)

  const started = performance.now()
  const response = await fetch(url, {
    method,
    headers,
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
