import { createFeedTail, takeRealtimeGap } from './eventFeed'
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
  callbacks.onRoster([], null)

  // --- Change feed -----------------------------------------------------------
  const tail = createFeedTail(workspaceName, callbacks, {
    onFirstBaseline() {
      // Taking over from a realtime connection that dropped: changes between
      // the drop and this baseline were signalled to nobody - refresh once,
      // after the baseline, so none of them is lost.
      if (takeRealtimeGap(workspaceName)) callbacks.onWorkspaceChanged()
    },
  })

  tail.tick()
  const eventsTimer = setInterval(() => tail.tick(), EVENTS_INTERVAL_MS)

  return {
    updatePosition() {
      // No presence over HTTP - positions only travel through the sidecar.
    },
    stop() {
      tail.stop()
      clearInterval(eventsTimer)
    },
  }
}
