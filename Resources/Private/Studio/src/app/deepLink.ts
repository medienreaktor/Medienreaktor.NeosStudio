/**
 * Deep link into a document:
 * `/neos/studio?nodeAggregateId=<id>&dimensionSpacePoint=<JSON>[&reveal=<id>]`, the parameters
 * named as in Neos.Api.
 *
 * Other backend surfaces (search modules, reports, notifications) need to send an editor to one
 * specific document. The shell otherwise restores its selection from localStorage only, so a link
 * had no way in.
 *
 * Two things make this awkward enough to deserve its own module:
 *
 * 1. The shell reaches the OAuth provider by redirecting the whole window, and returns to the bare
 *    `redirectUri` - any query parameter is gone by the time the app renders. The parameters are
 *    therefore lifted into sessionStorage on the very first module evaluation, before any redirect
 *    can happen, and survive the round trip there.
 * 2. The target is read once per document load, but consumed from two places (the initial
 *    dimension and the restored selection). It is resolved eagerly into a module constant instead
 *    of being read on demand, so both see the same value and neither can consume it from under the
 *    other.
 *
 * The parameters are stripped from the visible URL immediately (same reasoning as `cleanUrl()` in
 * the OAuth flow): a reload should land on wherever the editor navigated to since, not jump back.
 */

const STORAGE_KEY = 'neos-studio.deep_link'
const PARAMETERS = ['nodeAggregateId', 'dimensionSpacePoint', 'reveal'] as const

type Parameters = Record<(typeof PARAMETERS)[number], string | null>

function read(key: string): string | null {
  // sessionStorage is unavailable in some privacy modes; a deep link is a nicety, so degrade to
  // "no deep link" rather than taking the whole shell down with an exception.
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value)
  } catch {
    // Not persisted - the link still works as long as no login redirect intervenes.
  }
}

/**
 * The parameters are lifted in one pass so the URL is rewritten once, and so a link without
 * `reveal` clears one left over from an earlier link.
 */
function lift(): Parameters {
  const url = new URL(window.location.href)
  if (!url.searchParams.has('nodeAggregateId')) {
    try {
      return JSON.parse(read(STORAGE_KEY) ?? 'null') ?? none()
    } catch {
      return none()
    }
  }

  const lifted = none()
  for (const name of PARAMETERS) {
    const value = url.searchParams.get(name)
    lifted[name] = value === '' ? null : value
    url.searchParams.delete(name)
  }
  window.history.replaceState({}, document.title, url.toString())
  write(STORAGE_KEY, JSON.stringify(lifted))
  return lifted
}

function none(): Parameters {
  return { nodeAggregateId: null, dimensionSpacePoint: null, reveal: null }
}

function isDimensionSpacePoint(json: string): boolean {
  try {
    const point = JSON.parse(json) as unknown
    return point !== null && typeof point === 'object' && !Array.isArray(point)
  } catch {
    return false
  }
}

/** The document of a deep link, null without one or for a malformed one. */
function target(
  parameters: Parameters,
): { nodeAggregateId: string; dimensionSpacePoint: string } | null {
  const { nodeAggregateId, dimensionSpacePoint } = parameters
  if (nodeAggregateId === null || dimensionSpacePoint === null) {
    return null
  }
  // A malformed or truncated point is not followed.
  if (!isDimensionSpacePoint(dimensionSpacePoint)) {
    return null
  }
  return { nodeAggregateId, dimensionSpacePoint }
}

const lifted = lift()

/**
 * The document a deep link asked for, or null. The linking side knows *which* document in *which*
 * dimension, but not which workspace the editor is working in - a link must not drop them into
 * live, where they cannot edit. Callers combine the two fields with the current site's address,
 * which carries the content repository and workspace.
 */
export const deepLinkTarget = target(lifted)

/**
 * A content node *within* that document to select on arrival, as a bare aggregate id - the shell
 * resolves it against the document's subgraph anyway. Selecting it is enough to scroll it into view
 * and outline it, since the preview mirrors the shell's selection.
 *
 * Null when the link names only a page, which is also the right answer for a hit on a document
 * property (meta description, keywords): those live on the document node itself, so opening the
 * page already lands on them.
 */
export const deepLinkReveal: string | null =
  deepLinkTarget !== null ? lifted.reveal : null

/** Forget the pending deep link, so a later reload restores the normal selection. */
export function clearDeepLink(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}
