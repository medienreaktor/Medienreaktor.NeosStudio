import {
  fetchWorkspaceEvents,
  sendPresenceHeartbeat,
} from '@/api/collaboration'
import type {
  CollaborationPosition,
  CollaborationTransport,
  TransportCallbacks,
} from './transport'

/** Presence heartbeat cadence; the server keeps a beat alive for 30s. */
const PRESENCE_INTERVAL_MS = 5_000
/** Change-feed poll cadence - the perceived latency of remote edits. */
const EVENTS_INTERVAL_MS = 2_000

/**
 * The plain-HTTP transport: heartbeats presence and tails the workspace
 * change feed on intervals. Requires nothing but the API itself - the
 * default, and the automatic fallback while the realtime sidecar (see
 * websocketTransport) is unreachable.
 */
export function startPollingTransport(
  workspaceName: string,
  initialPosition: CollaborationPosition,
  callbacks: TransportCallbacks,
): CollaborationTransport {
  let disposed = false
  let position = initialPosition

  // --- Presence ------------------------------------------------------------
  const beat = () => {
    sendPresenceHeartbeat(workspaceName, {
      documentAggregateId: position.documentAggregateId,
      focusedAggregateId: position.focusedAggregateId,
      dimensionSpacePoint: position.dimensionSpacePoint,
    })
      .then((response) => {
        if (disposed) return
        callbacks.onRoster(response.users, response.you)
      })
      .catch(() => {
        /* a missed beat self-heals on the next interval */
      })
  }
  beat()
  let presenceTimer = setInterval(beat, PRESENCE_INTERVAL_MS)

  // --- Change feed -----------------------------------------------------------
  let inFlight = false
  let cursor: { stream: string; since: number } | null = null

  const poll = async () => {
    if (inFlight) return
    inFlight = true
    try {
      const response = await fetchWorkspaceEvents(workspaceName, cursor)
      if (disposed) return
      if (cursor === null) {
        // Baseline: adopt the current position, nothing to replay.
        cursor = {
          stream: response.contentStreamId,
          since: response.sequenceNumber,
        }
        return
      }
      if (
        response.reset ||
        response.truncated ||
        response.contentStreamId !== cursor.stream
      ) {
        cursor = {
          stream: response.contentStreamId,
          since: response.sequenceNumber,
        }
        callbacks.onWorkspaceChanged()
        return
      }
      cursor.since = response.sequenceNumber
      if (response.events.length > 0) callbacks.onEvents(response.events)
    } catch {
      /* offline / a hiccup - the next poll retries with the same cursor */
    } finally {
      inFlight = false
    }
  }

  void poll()
  const eventsTimer = setInterval(() => void poll(), EVENTS_INTERVAL_MS)

  return {
    updatePosition(next) {
      position = next
      // Beat out-of-band so colleagues' indicators follow within one feed
      // cycle instead of one interval; restart the timer so the next regular
      // beat is a full period away.
      clearInterval(presenceTimer)
      beat()
      presenceTimer = setInterval(beat, PRESENCE_INTERVAL_MS)
    },
    stop() {
      disposed = true
      clearInterval(presenceTimer)
      clearInterval(eventsTimer)
      // Leaving the session (or the app): drop the own entry right away so
      // colleagues do not see a ghost for the remaining TTL.
      void sendPresenceHeartbeat(workspaceName, { leave: true }).catch(() => {
        /* the entry expires on its own */
      })
    },
  }
}
