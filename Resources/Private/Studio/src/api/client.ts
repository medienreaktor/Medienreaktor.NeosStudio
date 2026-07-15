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
export async function apiFetch<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
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

/**
 * Multipart upload with progress. apiFetch is JSON-only; file uploads need
 * FormData and a real progress signal, so this drops to XMLHttpRequest (fetch
 * has no upload-progress event). Same bearer auth and base URL as apiFetch;
 * resolves with the parsed 2xx body and rejects with ApiError otherwise.
 */
export function apiUpload<T>(
  path: string,
  formData: FormData,
  options?: { method?: string; onProgress?: (fraction: number) => void },
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(options?.method ?? 'POST', config.apiBase + path)

    const tokens = getTokens()
    if (tokens)
      xhr.setRequestHeader('Authorization', `Bearer ${tokens.access_token}`)
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
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(parsed as T)
      } else {
        reject(new ApiError(xhr.status, parsed))
      }
    }
    xhr.onerror = () => reject(new ApiError(0, 'Network error during upload'))

    xhr.send(formData)
  })
}
