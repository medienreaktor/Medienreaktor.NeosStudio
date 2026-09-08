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
const PARAMETER = 'node'

function lift(): string | null {
  // sessionStorage is unavailable in some privacy modes; a deep link is a nicety, so degrade to
  // "no deep link" rather than taking the whole shell down with an exception.
  let stored: string | null = null
  try {
    stored = sessionStorage.getItem(STORAGE_KEY)
  } catch {
    stored = null
  }

  const url = new URL(window.location.href)
  const parameter = url.searchParams.get(PARAMETER)
  if (parameter === null) {
    return stored
  }

  url.searchParams.delete(PARAMETER)
  window.history.replaceState({}, document.title, url.toString())
  try {
    sessionStorage.setItem(STORAGE_KEY, parameter)
  } catch {
    // Not persisted - the link still works as long as no login redirect intervenes.
  }
  return parameter
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

/**
 * The document a deep link asked for, or null. Note that only `aggregateId` and
 * `dimensionSpacePoint` are meant to be used: the linking side knows *which* document in *which*
 * dimension, but not which workspace the editor is working in - a link built from the live
 * workspace must not drop them into live, where they cannot edit. Callers combine these two fields
 * with the current site address, which carries the content repository and workspace.
 */
export const deepLinkTarget: NodeAddress | null = parse(lift())

/** Forget the pending deep link, so a later reload restores the normal selection. */
export function clearDeepLink(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}
