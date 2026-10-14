import {
  fetchWorkspaceFeedBaseline,
  pollWorkspaceFeed,
} from '@/api/collaboration'
import type {
  CollaborationPosition,
  CollaborationTransport,
  TransportCallbacks,
} from './transport'

/** Change-feed poll cadence - the perceived latency of remote edits. */
const EVENTS_INTERVAL_MS = 2_000

/**
 * The plain-HTTP transport: tails the workspace's events in Neos.Api on an
 * interval. Requires nothing but the API itself - the default, and the
 * automatic fallback while the realtime sidecar (see websocketTransport) is
 * unreachable.
 *
 * Presence is NOT available here: it lives in the sidecar only (an HTTP
 * presence endpoint no longer exists). The transport reports an empty
 * roster once, so a roster left over from a dropped socket does not linger.
 */
export function startPollingTransport(
  workspaceName: string,
  _initialPosition: CollaborationPosition,
  callbacks: TransportCallbacks,
): CollaborationTransport {
  let disposed = false

  callbacks.onRoster([], null)

  // --- Change feed -----------------------------------------------------------
  let inFlight = false
  // null = no position yet: the next tick takes the baseline.
  let cursor: { stream: string; after: number } | null = null

  const poll = async () => {
    if (inFlight) return
    inFlight = true
    try {
      if (cursor === null) {
        // Baseline: adopt the current position, nothing to replay. A stream
        // without a visible event yet has no position - baseline again.
        const baseline = await fetchWorkspaceFeedBaseline(workspaceName)
        if (disposed) return
        if (baseline.after !== null) {
          cursor = { stream: baseline.stream, after: baseline.after }
        }
        return
      }
      const result = await pollWorkspaceFeed(workspaceName, cursor)
      if (disposed) return
      if (result.status === 'reset') {
        // The workspace moved to a different content stream (publish/
        // discard/rebase): its content changed wholesale. Re-baseline.
        cursor = null
        callbacks.onWorkspaceChanged()
        return
      }
      cursor = { stream: result.stream, after: result.after }
      if (result.truncated) {
        // More happened than one page describes - refresh wholesale and
        // continue from the end of this page.
        callbacks.onWorkspaceChanged()
        return
      }
      if (result.events.length > 0) callbacks.onEvents(result.events)
    } catch {
      /* offline / a hiccup - the next poll retries with the same cursor */
    } finally {
      inFlight = false
    }
  }

  void poll()
  const eventsTimer = setInterval(() => void poll(), EVENTS_INTERVAL_MS)

  return {
    updatePosition() {
      // No presence over HTTP - positions only travel through the sidecar.
    },
    stop() {
      disposed = true
      clearInterval(eventsTimer)
    },
  }
}
