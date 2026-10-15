import { config } from '@/config'
import { forceRefreshAccessToken, getValidAccessToken } from '@/auth/oauth'
import { ApiError } from './errors'

/**
 * The transport of the Neos API (Neos.Api's operations and the Studio's): the
 * shell's OAuth bearer token (one token carries the scopes of both), a single
 * refresh-and-retry on 401, the interface language, no HTTP caching - and an
 * ApiError for every non-2xx answer. The typed client (api/neos/client.ts)
 * sends every request through {@link authorizedFetch}; request() and upload()
 * are the untyped and the multipart variants on top of the same rules.
 */

/** The headers every request carries, the token's if there is one. */
function shellHeaders(token: string | null): Record<string, string> {
  const result: Record<string, string> = {
    Accept: 'application/json',
    // Neos.Api translates labels (node types, dimensions, roles) into the
    // request's language - the shell's interface language.
    'Accept-Language': config.interfaceLanguage,
  }
  if (token) result['Authorization'] = `Bearer ${token}`
  return result
}

/** The request with the shell's headers (the caller's win) and the token. */
function authorize(request: Request, token: string | null): Request {
  const headers = new Headers(request.headers)
  for (const [name, value] of Object.entries(shellHeaders(token))) {
    if (name === 'Authorization' || !headers.has(name)) headers.set(name, value)
  }
  // cache no-store: never let the browser's HTTP cache answer an API read.
  // Repeated reads often reuse the identical URL (the out-of-band render
  // of an element after each edit, node refetches after a command), and
  // Safari serves such fetches from its cache without revalidating unless
  // storing is forbidden outright - the editing UI would keep seeing
  // pre-edit state. Freshness caching lives in TanStack Query, not here.
  return new Request(request, { headers, cache: 'no-store' })
}

/**
 * fetch() for a request to the Neos API: sends it with the access token and,
 * if the server rejects a token the client believed valid (revoked
 * server-side, or clock skew), once more with a refreshed one. The response
 * is returned as it is - turning it into data or an ApiError is the caller's
 * part ({@link unwrap}). The request's AbortSignal travels along.
 */
export async function authorizedFetch(request: Request): Promise<Response> {
  // The body can be read once; keep a copy for the retry.
  const retry = request.clone()
  const token = await getValidAccessToken()
  const response = await fetch(authorize(request, token))
  if (response.status !== 401 || !token) return response
  const refreshed = await forceRefreshAccessToken(token)
  return refreshed ? fetch(authorize(retry, refreshed)) : response
}

/**
 * The data of a typed client call (api/neos/client.ts): resolves with the
 * parsed 2xx body (undefined for 204) and throws ApiError with the status and
 * the parsed problem document otherwise, so TanStack Query sees proper error
 * states (and the retry logic can distinguish 4xx from 5xx).
 */
export async function unwrap<D>(
  pending: Promise<{ data?: D; error?: unknown; response: Response }>,
): Promise<D> {
  const { data, error, response } = await pending
  if (!response.ok) throw new ApiError(response.status, error ?? null)
  return data as D
}

export interface FetchInit {
  method?: string
  body?: unknown
  signal?: AbortSignal
}

function parse(raw: string): unknown {
  if (raw === '') return null
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

/**
 * An untyped JSON request below the base URL, for paths the typed client does
 * not know (a plugin's own operations, see the plugin API's apiFetch):
 * resolves with the parsed body on 2xx (null for 204) and throws ApiError
 * otherwise.
 */
export async function request<T>(
  base: string,
  path: string,
  init?: FetchInit,
): Promise<T> {
  const body = init?.body !== undefined ? JSON.stringify(init.body) : undefined
  const response = await authorizedFetch(
    new Request(base + path, {
      method: init?.method ?? 'GET',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body,
      signal: init?.signal,
    }),
  )
  // 204 No Content (deletes, password changes, restores): nothing to parse.
  const parsed = parse(response.status === 204 ? '' : await response.text())
  if (!response.ok) throw new ApiError(response.status, parsed)
  return parsed as T
}

export interface UploadOptions {
  method?: string
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
}

/**
 * A multipart upload with progress below the base URL. The typed client is
 * fetch-based; file uploads need a real progress signal, so this drops to
 * XMLHttpRequest (fetch has no upload-progress event). Same bearer auth and
 * retry; resolves with the parsed 2xx body and rejects with ApiError
 * otherwise (an AbortError DOMException when the signal aborts).
 */
export async function upload<T>(
  base: string,
  path: string,
  formData: FormData,
  options: UploadOptions = {},
): Promise<T> {
  const { signal } = options
  const attempt = (token: string | null) =>
    new Promise<{ status: number; parsed: unknown }>((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason)
        return
      }
      const xhr = new XMLHttpRequest()
      xhr.open(options.method ?? 'POST', base + path)
      // No Content-Type - the browser adds the multipart boundary.
      for (const [name, value] of Object.entries(shellHeaders(token))) {
        xhr.setRequestHeader(name, value)
      }
      if (options.onProgress) {
        const onProgress = options.onProgress
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) onProgress(event.loaded / event.total)
        }
      }
      const onAbort = () => xhr.abort()
      signal?.addEventListener('abort', onAbort, { once: true })
      const settle = () => signal?.removeEventListener('abort', onAbort)
      xhr.onload = () => {
        settle()
        resolve({ status: xhr.status, parsed: parse(xhr.responseText) })
      }
      xhr.onerror = () => {
        settle()
        reject(new ApiError(0, 'Network error during upload'))
      }
      xhr.onabort = () => {
        settle()
        reject(
          signal?.reason ?? new DOMException('Upload aborted', 'AbortError'),
        )
      }
      xhr.send(formData)
    })

  const token = await getValidAccessToken()
  let result = await attempt(token)
  if (result.status === 401 && token) {
    const refreshed = await forceRefreshAccessToken(token)
    if (refreshed) result = await attempt(refreshed)
  }

  if (result.status >= 200 && result.status < 300) return result.parsed as T
  throw new ApiError(result.status, result.parsed)
}

/**
 * Appends the value as PHP reads nested query parameters: an object's
 * members as name[key], recursively, a nested list's items as name[index].
 * Undefined and null are left out.
 */
function appendNested(
  search: URLSearchParams,
  name: string,
  value: unknown,
): void {
  if (value === undefined || value === null) return
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      appendNested(search, `${name}[${index}]`, item),
    )
  } else if (typeof value === 'object') {
    for (const [key, member] of Object.entries(value)) {
      appendNested(search, `${name}[${key}]`, member)
    }
  } else {
    search.append(name, String(value))
  }
}

/**
 * The query string of the parameters, without the leading '?' ('' if none),
 * as Neos.Api (PHP) reads them: objects in bracket notation at any depth
 * (filterByHierarchy[type], arguments[a][b] - OpenAPI's deepObject, extended
 * to nesting, which openapi-fetch's own serializer does not do), a top-level
 * list as the key repeated. Undefined and null values are left out.
 */
export function serializeQuery(params: Record<string, unknown>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null)
          search.append(key, String(item))
      }
    } else {
      appendNested(search, key, value)
    }
  }
  return search.toString()
}

/**
 * A query string from the given parameters, leading '?' included ('' if
 * none) - for URLs built outside the typed client (the preview's). Serialized
 * as {@link serializeQuery}.
 */
export function queryString(params: Record<string, unknown>): string {
  const query = serializeQuery(params)
  return query === '' ? '' : `?${query}`
}
