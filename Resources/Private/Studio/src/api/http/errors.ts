/**
 * Errors of both APIs the shell talks to (Neos.Api and the Studio's own
 * endpoints): a failed request rejects with an ApiError carrying the status
 * and the parsed body.
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

/** The problem document of an API error, null for anything else. */
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

/** A 409 - a conflict the operation explains (asset in use, workspace not empty, ...). */
export function isConflict(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409
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
