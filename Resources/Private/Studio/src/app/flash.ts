/**
 * A one-shot request to make one element in the preview pulse for a moment.
 *
 * Selecting a node already scrolls it into view and outlines it, but an editor who arrived from a
 * deep link did not do the selecting and has no reason to look at the outline. The pulse says
 * "this one" once and then gets out of the way.
 *
 * The request is buffered rather than broadcast: it is raised while the document is still being
 * fetched, long before the preview has a guest to talk to. The PreviewPane drains it once its guest
 * is ready, so either order works - request first, or subscriber first.
 *
 * A plain module-level signal, same reasoning as the boot handshake in ./boot: shell-internal, not
 * plugin API.
 */
let pending: string | null = null
const listeners = new Set<() => void>()

/** Ask for the element of this node aggregate to pulse, as soon as the preview can show it. */
export function flashNode(aggregateId: string): void {
  pending = aggregateId
  for (const listener of listeners) listener()
}

/** The pending request, if any - consuming it, so a pulse never repeats on a later reload. */
export function takePendingFlash(): string | null {
  const request = pending
  pending = null
  return request
}

export function subscribeFlashRequest(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
