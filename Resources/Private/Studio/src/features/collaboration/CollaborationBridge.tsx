import { useEffect, useRef } from 'react'
import type { PresenceUser, WorkspaceFeedEvent } from '@/api/collaboration'
import {
  dimensionSpacePointEquals,
  type DimensionSpacePoint,
} from '@/api/dimensions'
import { config } from '@/config'
import { startPollingTransport } from './pollingTransport'
import { startWebsocketTransport } from './websocketTransport'
import type { CollaborationTransport, TransportCallbacks } from './transport'
import type { PresencePeer } from './PresenceContext'
import { presenceColor, presenceInitials } from './presenceColors'

/**
 * How long the realtime connection may be down before the polling fallback
 * kicks in. Covers the initial connection attempt too: a session starts
 * "disconnected" and either the socket or this timer wins.
 */
const POLLING_FALLBACK_AFTER_MS = 3_000

/**
 * The engine of a collaborative session, mounted while the editing context is
 * a shared workspace. Renders nothing; it owns the transport and interprets
 * what comes back:
 *
 * - Presence: "I am here, on this document, focusing this node" - announced
 *   immediately on position changes; the roster of everyone else surfaces as
 *   onPresence.
 *
 * - Change feed: the workspace's event log. Remote colleagues' content edits
 *   surface as onRemoteContentChange (affected node aggregate ids, for
 *   in-place element re-renders); anything structural - or a content-stream
 *   move (someone published/discarded/rebased the session), or a missed
 *   window - surfaces as onRemoteWorkspaceChange (refresh everything). Own
 *   events are filtered out via initiatingUserId: the UI already refreshed
 *   when it issued the command.
 *
 * The transport is pluggable (see transport.ts): plain HTTP polling by
 * default; when a realtime sidecar is configured (config.realtime.url) a
 * Hocuspocus WebSocket carries both concerns with polling as automatic
 * fallback while the socket is down. Interpretation (self/dimension
 * filtering, content-vs-structure classification, roster dedup) lives here so
 * every transport behaves identically.
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
  // Latest-value refs keep the transport session stable while props change
  // beneath it - a re-created transport would tear down its connection (or
  // reset its poll cadence) on every render.
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
  const positionRef = useRef({
    documentAggregateId,
    focusedAggregateId,
    dimensionSpacePoint,
  })
  positionRef.current = {
    documentAggregateId,
    focusedAggregateId,
    dimensionSpacePoint,
  }
  const ownUserIdRef = useRef(ownUserId)
  ownUserIdRef.current = ownUserId
  // Serialized last roster - identical reports do not re-render the app.
  const lastPresenceRef = useRef<string | null>(null)
  // The running transports, for out-of-band position announcements. During a
  // realtime outage this briefly holds two (socket + polling fallback).
  const transportsRef = useRef<CollaborationTransport[]>([])

  useEffect(() => {
    // --- Interpretation: identical for every transport ----------------------
    const handleRoster = (users: PresenceUser[], you: string | null) => {
      const self = you ?? ownUserIdRef.current
      const peers = users
        .filter((user) => user.userId !== self)
        .map((user) => ({
          ...user,
          color: presenceColor(user.userId),
          initials: presenceInitials(user.name),
        }))
      const serialized = JSON.stringify({ peers, you: self })
      if (serialized === lastPresenceRef.current) return
      lastPresenceRef.current = serialized
      callbacksRef.current.onPresence({ peers, you: self })
    }

    const affectsCurrentDimension = (event: WorkspaceFeedEvent): boolean => {
      const current = positionRef.current.dimensionSpacePoint
      // No own dimension resolved yet, or the event names none: be generous
      // and refresh - a spurious refresh is cheap, a missed one is a lie.
      if (current === null || event.dimensionSpacePoints.length === 0)
        return true
      return event.dimensionSpacePoints.some((point) =>
        dimensionSpacePointEquals(point, current),
      )
    }

    const handleEvents = (events: WorkspaceFeedEvent[]) => {
      const own = ownUserIdRef.current
      const remote = events.filter(
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
    }

    const transportCallbacks: TransportCallbacks = {
      onRoster: handleRoster,
      onEvents: handleEvents,
      onWorkspaceChanged: () => callbacksRef.current.onRemoteWorkspaceChange(),
    }

    // --- Transport selection + polling fallback -----------------------------
    const transports: CollaborationTransport[] = []
    let fallback: CollaborationTransport | null = null
    let fallbackTimer: number | null = null
    let disposed = false

    const startFallback = () => {
      if (disposed || fallback !== null || fallbackTimer !== null) return
      fallbackTimer = window.setTimeout(() => {
        fallbackTimer = null
        if (disposed || fallback !== null) return
        fallback = startPollingTransport(
          workspaceName,
          positionRef.current,
          transportCallbacks,
        )
        transports.push(fallback)
      }, POLLING_FALLBACK_AFTER_MS)
    }
    const stopFallback = () => {
      if (fallbackTimer !== null) {
        clearTimeout(fallbackTimer)
        fallbackTimer = null
      }
      if (fallback !== null) {
        fallback.stop()
        transports.splice(transports.indexOf(fallback), 1)
        fallback = null
      }
    }

    const realtimeUrl = config.realtime?.url ?? null
    if (realtimeUrl) {
      transports.push(
        startWebsocketTransport(realtimeUrl, workspaceName, positionRef.current, {
          ...transportCallbacks,
          onStatus: (connected) => {
            if (connected) stopFallback()
            else startFallback()
          },
        }),
      )
      // The session starts unconnected: arm the fallback now, the socket's
      // first onConnect disarms it.
      startFallback()
    } else {
      transports.push(
        startPollingTransport(
          workspaceName,
          positionRef.current,
          transportCallbacks,
        ),
      )
    }
    transportsRef.current = transports

    return () => {
      disposed = true
      if (fallbackTimer !== null) clearTimeout(fallbackTimer)
      for (const transport of [...transports]) transport.stop()
      transportsRef.current = []
      lastPresenceRef.current = null
    }
  }, [workspaceName])

  // A document/focus change announces the new position out-of-band, so
  // colleagues' indicators follow in one feed cycle instead of one interval -
  // WITHOUT restarting the transport (a torn-down connection on every node
  // click would defeat a persistent socket).
  const mounted = useRef(false)
  useEffect(() => {
    if (!mounted.current) {
      // The transport already announced the initial position on start.
      mounted.current = true
      return
    }
    for (const transport of transportsRef.current) {
      transport.updatePosition(positionRef.current)
    }
  }, [documentAggregateId, focusedAggregateId])

  return null
}
