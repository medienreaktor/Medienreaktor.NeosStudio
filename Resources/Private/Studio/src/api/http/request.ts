import { config } from '@/config'
import { forceRefreshAccessToken, getValidAccessToken } from '@/auth/oauth'
import { ApiError } from './errors'

/**
 * The transport both API clients share: JSON over fetch with the shell's
 * OAuth bearer token (one token carries the scopes of both APIs), a single
 * refresh-and-retry on 401, and an ApiError for every non-2xx answer.
 */

export interface FetchInit {
  method?: string
  body?: unknown
}

function headers(token: string | null): Record<string, string> {
  const result: Record<string, string> = {
    Accept: 'application/json',
    // Neos.Api translates labels (node types, dimensions, roles) into the
    // request's language - the shell's interface language.
    'Accept-Language': config.interfaceLanguage,
  }
  if (token) result['Authorization'] = `Bearer ${token}`
  return result
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
 * A JSON request below the base URL: resolves with the parsed body on 2xx
 * (null for 204) and throws ApiError otherwise, so TanStack Query sees proper
 * error states (and the retry logic can distinguish 4xx from 5xx).
 */
export async function request<T>(
  base: string,
  path: string,
  init?: FetchInit,
): Promise<T> {
  const method = init?.method ?? 'GET'
  const body = init?.body !== undefined ? JSON.stringify(init.body) : undefined

  const send = (token: string | null): Promise<Response> =>
    // cache no-store: never let the browser's HTTP cache answer an API read.
    // Repeated reads often reuse the identical URL (the out-of-band render
    // of an element after each edit, node refetches after a command), and
    // Safari serves such fetches from its cache without revalidating unless
    // storing is forbidden outright - the editing UI would keep seeing
    // pre-edit state. Freshness caching lives in TanStack Query, not here.
    fetch(base + path, {
      method,
      headers: {
        ...headers(token),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body,
      cache: 'no-store',
    })

  const token = await getValidAccessToken()
  let response = await send(token)
  // A token we believed valid can still be rejected (revoked server-side, or
  // clock skew). Refresh once and retry before surfacing the error.
  if (response.status === 401 && token) {
    const refreshed = await forceRefreshAccessToken()
    if (refreshed) response = await send(refreshed)
  }

  // 204 No Content (deletes, password changes, restores): nothing to parse.
  const parsed = parse(response.status === 204 ? '' : await response.text())
  if (!response.ok) throw new ApiError(response.status, parsed)
  return parsed as T
}

/**
 * A multipart upload with progress below the base URL. request() is
 * JSON-only; file uploads need FormData and a real progress signal, so this
 * drops to XMLHttpRequest (fetch has no upload-progress event). Same bearer
 * auth and retry; resolves with the parsed 2xx body and rejects with ApiError
 * otherwise.
 */
export async function upload<T>(
  base: string,
  path: string,
  formData: FormData,
  options?: { method?: string; onProgress?: (fraction: number) => void },
): Promise<T> {
  const attempt = (token: string | null) =>
    new Promise<{ status: number; parsed: unknown }>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open(options?.method ?? 'POST', base + path)
      // No Content-Type - the browser adds the multipart boundary.
      for (const [name, value] of Object.entries(headers(token))) {
        xhr.setRequestHeader(name, value)
      }
      if (options?.onProgress) {
        const onProgress = options.onProgress
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) onProgress(event.loaded / event.total)
        }
      }
      xhr.onload = () =>
        resolve({ status: xhr.status, parsed: parse(xhr.responseText) })
      xhr.onerror = () => reject(new ApiError(0, 'Network error during upload'))
      xhr.send(formData)
    })

  const token = await getValidAccessToken()
  let result = await attempt(token)
  if (result.status === 401 && token) {
    const refreshed = await forceRefreshAccessToken()
    if (refreshed) result = await attempt(refreshed)
  }

  if (result.status >= 200 && result.status < 300) return result.parsed as T
  throw new ApiError(result.status, result.parsed)
}

/**
 * A query string from the given parameters, leading '?' included ('' if
 * none). Undefined and null values are left out; arrays repeat the key.
 */
export function queryString(
  params: Record<
    string,
    string | number | boolean | null | undefined | readonly string[]
  >,
): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      for (const item of value) search.append(key, item)
    } else {
      search.set(key, String(value))
    }
  }
  const query = search.toString()
  return query === '' ? '' : `?${query}`
}
