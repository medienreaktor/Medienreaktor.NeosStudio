import { config } from '@/config'
import { forceRefreshAccessToken, getValidAccessToken } from '@/auth/oauth'

/**
 * Two APIs share the shell's OAuth session (one token carries the scopes of
 * both):
 *  - Neos.Api below config.apiBase ('/api') - content, workspaces, media,
 *    users, sites: apiFetch / apiUpload
 *  - the Studio's own endpoints below config.studioApiBase
 *    ('/neos/studio/api') - tasks, notifications, access roles, preview
 *    links, review and history: studioFetch
 */

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
 * An RFC 9457 problem document, as Neos.Api answers every error. Operations
 * add their own members (e.g. a workspace conflict's "conflicts").
 */
export interface Problem {
  type?: string
  title?: string
  status?: number
  detail?: string
  [member: string]: unknown
}

/** The problem document of a Neos.Api error, null for anything else. */
export function problemOf(error: unknown): Problem | null {
  if (!(error instanceof ApiError)) return null
  const body = error.body
  return body !== null && typeof body === 'object' ? (body as Problem) : null
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
 * The server's human-readable explanation from an ApiError body, or the
 * fallback: a problem document's detail (Neos.Api), or the error_description
 * of the Studio's own endpoints. ApiError.message is only the generic status
 * line; toasts should show what the server actually complained about.
 */
export function apiErrorDescription(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    const body = error.body as {
      detail?: unknown
      title?: unknown
      error_description?: unknown
    } | null
    if (body && typeof body === 'object') {
      if (typeof body.detail === 'string' && body.detail !== '')
        return body.detail
      if (typeof body.error_description === 'string')
        return body.error_description
      if (typeof body.title === 'string' && body.title !== '') return body.title
    }
  }
  return fallback
}

export interface FetchInit {
  method?: string
  body?: unknown
}

async function request<T>(
  base: string,
  path: string,
  init?: FetchInit,
): Promise<T> {
  const method = init?.method ?? 'GET'
  const body = init?.body !== undefined ? JSON.stringify(init.body) : undefined

  const send = (token: string | null): Promise<Response> => {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      // Neos.Api translates labels (node types, dimensions, roles) into the
      // request's language - the shell's interface language.
      'Accept-Language': config.interfaceLanguage,
    }
    if (token) headers['Authorization'] = `Bearer ${token}`
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    // cache no-store: never let the browser's HTTP cache answer an API read.
    // Repeated reads often reuse the identical URL (the out-of-band render
    // of an element after each edit, node refetches after a command), and
    // Safari serves such fetches from its cache without revalidating unless
    // storing is forbidden outright - the editing UI would keep seeing
    // pre-edit state. Freshness caching lives in TanStack Query, not here.
    return fetch(base + path, {
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

  // 204 No Content (deletes, password changes, restores): nothing to parse.
  const raw = response.status === 204 ? '' : await response.text()

  let parsed: unknown = raw === '' ? null : raw
  try {
    if (raw !== '') parsed = JSON.parse(raw)
  } catch {
    /* keep raw text */
  }

  if (!response.ok) throw new ApiError(response.status, parsed)
  return parsed as T
}

/**
 * Typed request against Neos.Api for query/mutation hooks: resolves with the
 * parsed body on 2xx (null for 204) and throws ApiError otherwise, so
 * TanStack Query sees proper error states (and the retry logic can
 * distinguish 4xx from 5xx).
 */
export function apiFetch<T>(path: string, init?: FetchInit): Promise<T> {
  return request<T>(config.apiBase, path, init)
}

/** Typed request against the Studio's own endpoints (/neos/studio/api). */
export function studioFetch<T>(path: string, init?: FetchInit): Promise<T> {
  return request<T>(config.studioApiBase, path, init)
}

/** A Neos.Api listing: {data, meta: {total}, links}. */
export interface Listing<T, M = { total: number }> {
  data: T[]
  meta: M
  links?: {
    self?: string
    first?: string
    prev?: string | null
    next?: string | null
    last?: string
  }
}

/** Neos.Api's maximum page size. */
export const MAX_PAGE_SIZE = 100

/**
 * Every item of a paginated Neos.Api listing: requests pages of the maximum
 * size and follows links.next until it runs out. For the lists the shell
 * needs in full (tree levels, changes, the user roster) - not for listings a
 * UI pages through itself (the media browser).
 *
 * `path` may carry a query; offset and limit are set here.
 */
export async function fetchAllPages<T>(path: string): Promise<T[]> {
  const separator = path.includes('?') ? '&' : '?'
  const items: T[] = []
  let offset = 0
  for (;;) {
    const page = await apiFetch<Listing<T>>(
      `${path}${separator}offset=${offset}&limit=${MAX_PAGE_SIZE}`,
    )
    items.push(...page.data)
    // Advance by the requested page size, not by what came back: a listing
    // may drop items from a page after paging (Neos.Api's node read filters),
    // and counting those would re-request the overlap.
    offset += MAX_PAGE_SIZE
    if (!page.links?.next || offset >= (page.meta?.total ?? Infinity)) {
      return items
    }
  }
}

/**
 * A query string from the given parameters, leading '?' included ('' if
 * none). Undefined and null values are left out; arrays repeat the key.
 */
export function queryString(
  params: Record<string, string | number | boolean | null | undefined | string[]>,
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

/**
 * Multipart upload with progress against Neos.Api. apiFetch is JSON-only;
 * file uploads need FormData and a real progress signal, so this drops to
 * XMLHttpRequest (fetch has no upload-progress event). Same bearer auth and
 * base URL as apiFetch; resolves with the parsed 2xx body and rejects with
 * ApiError otherwise.
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
      xhr.setRequestHeader('Accept', 'application/json')
      xhr.setRequestHeader('Accept-Language', config.interfaceLanguage)
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
