import { useEffect, useRef } from 'react'
import {
  fetchWorkspaceEvents,
  sendPresenceHeartbeat,
  type WorkspaceFeedEvent,
} from '@/api/collaboration'
import {
  dimensionSpacePointEquals,
  type DimensionSpacePoint,
} from '@/api/dimensions'
import type { PresencePeer } from './PresenceContext'
import { presenceColor, presenceInitials } from './presenceColors'

/** Presence heartbeat cadence; the server keeps a beat alive for 30s. */
const PRESENCE_INTERVAL_MS = 5_000
/** Change-feed poll cadence - the perceived latency of remote edits. */
const EVENTS_INTERVAL_MS = 2_000

/**
 * The engine of a collaborative session, mounted while the editing context is
 * a shared workspace. Renders nothing; it drives the two polling loops:
 *
 * - Presence: heartbeats "I am here, on this document, focusing this node"
 *   and reports back who else is in the workspace (onPresence). Beats
 *   immediately when the own position changes, so colleagues see focus moves
 *   without waiting out the interval, and announces leaving on unmount.
 *
 * - Change feed: tails the workspace's event log. Remote colleagues' content
 *   edits surface as onRemoteContentChange (affected node aggregate ids, for
 *   in-place element re-renders); anything structural - or a content-stream
 *   move (someone published/discarded/rebased the session), or a truncated
 *   feed - surfaces as onRemoteWorkspaceChange (refresh everything). Own
 *   events are filtered out via initiatingUserId: the UI already refreshed
 *   when it issued the command.
 */
export function CollaborationBridge({
  workspaceName,
  ownUserId,
  documentAggregateId,
  focusedAggregateId,
  dimensionSpacePoint,
  onPresence,
  onRemoteContentChange,
  onRemoteWorkspaceChange,
}: {
  workspaceName: string
  /** From /me - used to filter own feed events; null skips the filter. */
  ownUserId: string | null
  documentAggregateId: string | null
  focusedAggregateId: string | null
  dimensionSpacePoint: DimensionSpacePoint | null
  onPresence: (state: { peers: PresencePeer[]; you: string | null }) => void
  onRemoteContentChange: (nodeAggregateIds: string[]) => void
  onRemoteWorkspaceChange: () => void
}) {
  // Latest-value refs keep the intervals stable while props change beneath
  // them - a re-subscribed interval would reset its cadence on every render.
  const callbacksRef = useRef({
    onPresence,
    onRemoteContentChange,
    onRemoteWorkspaceChange,
  })
  callbacksRef.current = {
    onPresence,
    onRemoteContentChange,
    onRemoteWorkspaceChange,
  }
  const positionRef = useRef({ documentAggregateId, focusedAggregateId })
  positionRef.current = { documentAggregateId, focusedAggregateId }
  const dimensionRef = useRef(dimensionSpacePoint)
  dimensionRef.current = dimensionSpacePoint
  const ownUserIdRef = useRef(ownUserId)
  ownUserIdRef.current = ownUserId
  // Serialized last roster - identical polls do not re-render the app.
  const lastPresenceRef = useRef<string | null>(null)

  // --- Presence ------------------------------------------------------------
  useEffect(() => {
    let disposed = false
    const beat = () => {
      sendPresenceHeartbeat(workspaceName, {
        documentAggregateId: positionRef.current.documentAggregateId,
        focusedAggregateId: positionRef.current.focusedAggregateId,
        dimensionSpacePoint: dimensionRef.current,
      })
        .then((response) => {
          if (disposed) return
          const you = response.you
          const peers = response.users
            .filter((user) => user.userId !== you)
            .map((user) => ({
              ...user,
              color: presenceColor(user.userId),
              initials: presenceInitials(user.name),
            }))
          const serialized = JSON.stringify({ peers, you })
          if (serialized === lastPresenceRef.current) return
          lastPresenceRef.current = serialized
          callbacksRef.current.onPresence({ peers, you })
        })
        .catch(() => {
          /* a missed beat self-heals on the next interval */
        })
    }
    beat()
    const timer = setInterval(beat, PRESENCE_INTERVAL_MS)
    return () => {
      disposed = true
      clearInterval(timer)
      // Leaving the session (or the app): drop the own entry right away so
      // colleagues do not see a ghost for the remaining TTL.
      void sendPresenceHeartbeat(workspaceName, { leave: true }).catch(() => {
        /* the entry expires on its own */
      })
    }
    // Re-keyed by position: a document/focus change beats immediately, so
    // colleagues' indicators follow in one feed cycle instead of one interval.
  }, [workspaceName, documentAggregateId, focusedAggregateId])

  // --- Change feed -----------------------------------------------------------
  useEffect(() => {
    let disposed = false
    let inFlight = false
    let cursor: { stream: string; since: number } | null = null

    const affectsCurrentDimension = (event: WorkspaceFeedEvent): boolean => {
      const current = dimensionRef.current
      // No own dimension resolved yet, or the event names none: be generous
      // and refresh - a spurious refresh is cheap, a missed one is a lie.
      if (current === null || event.dimensionSpacePoints.length === 0)
        return true
      return event.dimensionSpacePoints.some((point) =>
        dimensionSpacePointEquals(point, current),
      )
    }

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
          // The workspace content changed wholesale (someone published,
          // discarded or rebased the session) or the feed overflowed -
          // incremental updates cannot describe this.
          cursor = {
            stream: response.contentStreamId,
            since: response.sequenceNumber,
          }
          callbacksRef.current.onRemoteWorkspaceChange()
          return
        }
        cursor.since = response.sequenceNumber
        const own = ownUserIdRef.current
        const remote = response.events.filter(
          (event) =>
            (own === null || event.initiatingUserId !== own) &&
            affectsCurrentDimension(event),
        )
        if (remote.length === 0) return
        if (remote.some((event) => event.kind === 'structure')) {
          // Created/moved/removed/retagged nodes reshape trees and page
          // alike; the wholesale refresh handles remote deletions of the
          // very node the user is looking at gracefully.
          callbacksRef.current.onRemoteWorkspaceChange()
          return
        }
        const ids = [
          ...new Set(
            remote
              .map((event) => event.nodeAggregateId)
              .filter((id): id is string => id !== null),
          ),
        ]
        if (ids.length > 0) callbacksRef.current.onRemoteContentChange(ids)
      } catch {
        /* offline / a hiccup - the next poll retries with the same cursor */
      } finally {
        inFlight = false
      }
    }

    void poll()
    const timer = setInterval(() => void poll(), EVENTS_INTERVAL_MS)
    return () => {
      disposed = true
      clearInterval(timer)
    }
  }, [workspaceName])

  return null
}
