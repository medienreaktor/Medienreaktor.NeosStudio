import { config } from '@/config'
import { forceRefreshAccessToken, getValidAccessToken } from '@/auth/oauth'

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
 * A 404 from a node endpoint means the node no longer exists - routine after a
 * node is deleted and the workspace published/synchronized, so callers (the
 * trees, the outliner) treat it as "gone" rather than a loading error.
 */
export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404
}

/**
 * The server's human-readable error_description from an ApiError body, or the
 * fallback. ApiError.message is only the generic status line; toasts should
 * show what the server actually complained about.
 */
export function apiErrorDescription(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    const body = error.body as { error_description?: unknown } | null
    if (body && typeof body.error_description === 'string') {
      return body.error_description
    }
  }
  return fallback
}

/**
 * Typed request for query/mutation hooks: resolves with the parsed body on
 * 2xx and throws ApiError otherwise, so TanStack Query sees proper error
 * states (and the retry logic can distinguish 4xx from 5xx).
 */
export async function apiFetch<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const method = init?.method ?? 'GET'
  const body = init?.body !== undefined ? JSON.stringify(init.body) : undefined

  const send = (token: string | null): Promise<Response> => {
    const headers: Record<string, string> = {}
    if (token) headers['Authorization'] = `Bearer ${token}`
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    // cache no-store: never let the browser's HTTP cache answer an API read.
    // Repeated reads often reuse the identical URL (the out-of-band /render
    // of an element after each edit, node refetches after a command), and
    // Safari serves such fetches from its cache without revalidating unless
    // storing is forbidden outright - the editing UI would keep seeing
    // pre-edit state. Freshness caching lives in TanStack Query, not here.
    return fetch(config.apiBase + path, {
      method,
      headers,
      body,
      cache: 'no-store',
    })
  }

  const token = await getValidAccessToken()
  let response = await send(token)
  // A token we believed valid can still be rejected (revoked server-side, or
  // clock skew). Refresh once and retry before surfacing the error.
  if (response.status === 401 && token) {
    const refreshed = await forceRefreshAccessToken()
    if (refreshed) response = await send(refreshed)
  }

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

/**
 * Multipart upload with progress. apiFetch is JSON-only; file uploads need
 * FormData and a real progress signal, so this drops to XMLHttpRequest (fetch
 * has no upload-progress event). Same bearer auth and base URL as apiFetch;
 * resolves with the parsed 2xx body and rejects with ApiError otherwise.
 */
export async function apiUpload<T>(
  path: string,
  formData: FormData,
  options?: { method?: string; onProgress?: (fraction: number) => void },
): Promise<T> {
  const method = options?.method ?? 'POST'

  const attempt = (token: string | null) =>
    new Promise<{ status: number; parsed: unknown }>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open(method, config.apiBase + path)
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
      // Do NOT set Content-Type - the browser adds the multipart boundary.

      if (options?.onProgress) {
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable)
            options.onProgress!(event.loaded / event.total)
        }
      }

      xhr.onload = () => {
        let parsed: unknown = xhr.responseText
        try {
          parsed = JSON.parse(xhr.responseText)
        } catch {
          /* keep raw text */
        }
        resolve({ status: xhr.status, parsed })
      }
      xhr.onerror = () => reject(new ApiError(0, 'Network error during upload'))

      xhr.send(formData)
    })

  const token = await getValidAccessToken()
  let result = await attempt(token)
  // Refresh once and retry on rejection, mirroring apiFetch.
  if (result.status === 401 && token) {
    const refreshed = await forceRefreshAccessToken()
    if (refreshed) result = await attempt(refreshed)
  }

  if (result.status >= 200 && result.status < 300) return result.parsed as T
  throw new ApiError(result.status, result.parsed)
}

/** One Server-Sent Event as received by apiStream. */
export interface StreamEvent {
  /** The event's `data:` lines, joined with newlines. */
  data: string
  /** The `event:` field; `message` when the server sent none. */
  event: string
  /** The last `id:` field seen on the stream, or null. */
  id: string | null
}

/**
 * Streaming request for endpoints that answer with Server-Sent Events, e.g. a
 * long-running job that reports progress. Same bearer auth, token refresh and
 * base URL as apiFetch, but the body is read incrementally: onEvent runs for
 * every event as it arrives. Resolves when the server closes the stream (or
 * `signal` aborts it, which rejects with the AbortError); a non-2xx response
 * rejects with ApiError before any event is delivered.
 */
export async function apiStream(
  path: string,
  init: {
    method?: string
    body?: unknown
    signal?: AbortSignal
    onEvent: (event: StreamEvent) => void
  },
): Promise<void> {
  const method = init.method ?? 'GET'
  const body = init.body !== undefined ? JSON.stringify(init.body) : undefined

  const send = (token: string | null): Promise<Response> => {
    const headers: Record<string, string> = { Accept: 'text/event-stream' }
    if (token) headers['Authorization'] = `Bearer ${token}`
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    return fetch(config.apiBase + path, {
      method,
      headers,
      body,
      cache: 'no-store',
      signal: init.signal,
    })
  }

  const token = await getValidAccessToken()
  let response = await send(token)
  // Refresh once and retry on rejection, mirroring apiFetch.
  if (response.status === 401 && token) {
    const refreshed = await forceRefreshAccessToken()
    if (refreshed) response = await send(refreshed)
  }

  if (!response.ok || !response.body) {
    const raw = await response.text()
    let parsed: unknown = raw
    try {
      parsed = JSON.parse(raw)
    } catch {
      /* keep raw text */
    }
    throw new ApiError(response.status, parsed)
  }

  // Minimal SSE parser (WHATWG event stream format): events are separated by
  // a blank line; `data:` lines accumulate, `event:`/`id:` set fields, lines
  // starting with `:` are comments.
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  let data: string[] = []
  let event = ''
  let id: string | null = null

  const processLine = (line: string) => {
    if (line === '') {
      if (data.length > 0) {
        init.onEvent({ data: data.join('\n'), event: event || 'message', id })
      }
      data = []
      event = ''
      return
    }
    if (line.startsWith(':')) return
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'data') data.push(value)
    else if (field === 'event') event = value
    else if (field === 'id') id = value
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += value
    const lines = buffer.split('\n').map((line) => line.replace(/\r$/, ''))
    buffer = lines.pop() ?? ''
    lines.forEach(processLine)
  }
  if (buffer !== '') processLine(buffer)
  processLine('')
}
