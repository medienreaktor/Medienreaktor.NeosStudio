import { decodeNodeAddress, type NodeAddress } from '@/api/nodeAddress'

/**
 * Deep link into a document: `/neos/studio?node=<base64url node address>`.
 *
 * Other backend surfaces (search modules, reports, notifications) need to send an editor to one
 * specific document. The shell otherwise restores its selection from localStorage only, so a link
 * had no way in.
 *
 * Two things make this awkward enough to deserve its own module:
 *
 * 1. The shell reaches the OAuth provider by redirecting the whole window, and returns to the bare
 *    `redirectUri` - any query parameter is gone by the time the app renders. The parameter is
 *    therefore lifted into sessionStorage on the very first module evaluation, before any redirect
 *    can happen, and survives the round trip there.
 * 2. The address is read once per document load, but consumed from two places (the initial
 *    dimension and the restored selection). It is resolved eagerly into a module constant instead
 *    of being read on demand, so both see the same value and neither can consume it from under the
 *    other.
 *
 * The parameter is stripped from the visible URL immediately (same reasoning as `cleanUrl()` in
 * the OAuth flow): a reload should land on wherever the editor navigated to since, not jump back.
 */

const STORAGE_KEY = 'neos-studio.deep_link'
const REVEAL_STORAGE_KEY = 'neos-studio.deep_link_reveal'
const PARAMETER = 'node'
const REVEAL_PARAMETER = 'reveal'

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
 * Both parameters are lifted in one pass so the URL is rewritten once, and so a link carrying only
 * `node` clears a `reveal` left over from an earlier one.
 */
function lift(): { node: string | null; reveal: string | null } {
  const url = new URL(window.location.href)
  const node = url.searchParams.get(PARAMETER)
  const reveal = url.searchParams.get(REVEAL_PARAMETER)
  if (node === null) {
    return { node: read(STORAGE_KEY), reveal: read(REVEAL_STORAGE_KEY) }
  }

  url.searchParams.delete(PARAMETER)
  url.searchParams.delete(REVEAL_PARAMETER)
  window.history.replaceState({}, document.title, url.toString())
  write(STORAGE_KEY, node)
  write(REVEAL_STORAGE_KEY, reveal ?? '')
  return { node, reveal: reveal === '' ? null : reveal }
}

function parse(encoded: string | null): NodeAddress | null {
  if (encoded === null) {
    return null
  }
  try {
    const address = decodeNodeAddress(encoded)
    // A malformed or truncated parameter decodes to something arbitrary; require the two fields
    // this feature actually uses rather than trusting the cast.
    if (typeof address.aggregateId !== 'string' || address.aggregateId === '') {
      return null
    }
    if (
      typeof address.dimensionSpacePoint !== 'object' ||
      address.dimensionSpacePoint === null
    ) {
      return null
    }
    return address
  } catch {
    return null
  }
}

const lifted = lift()

/**
 * The document a deep link asked for, or null. Note that only `aggregateId` and
 * `dimensionSpacePoint` are meant to be used: the linking side knows *which* document in *which*
 * dimension, but not which workspace the editor is working in - a link built from the live
 * workspace must not drop them into live, where they cannot edit. Callers combine these two fields
 * with the current site address, which carries the content repository and workspace.
 */
export const deepLinkTarget: NodeAddress | null = parse(lifted.node)

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
  deepLinkTarget !== null && lifted.reveal !== null && lifted.reveal !== ''
    ? lifted.reveal
    : null

/** Forget the pending deep link, so a later reload restores the normal selection. */
export function clearDeepLink(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
    sessionStorage.removeItem(REVEAL_STORAGE_KEY)
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}
