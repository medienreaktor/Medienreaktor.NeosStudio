import { HocuspocusProvider, WebSocketStatus } from '@hocuspocus/provider'
import * as Y from 'yjs'
import type { PresenceUser } from '@/features/collaboration/types'
import { getValidAccessToken } from '@/auth/oauth'
import { clearRealtimeGap, createFeedTail, markRealtimeGap } from './eventFeed'
import type { LiveEdit } from './liveEdits'
import type {
  CollaborationPosition,
  CollaborationTransport,
  TransportCallbacks,
} from './transport'

/**
 * Messages the realtime sidecar (Resources/Private/Realtime/server.js) sends over the stateless
 * channel of the Hocuspocus connection. `changed` carries no events, only the
 * workspace's new feed head (content stream + newest sequence number): the
 * events themselves are read from Neos.Api with the editor's own token.
 */
type ServerMessage =
  | { type: 'presence'; users: PresenceUser[] }
  | {
      type: 'changed'
      contentStreamId: string
      sequenceNumber: number | null
    }
  | ({ type: 'liveEdit' } & LiveEdit)

/**
 * The WebSocket transport: one Hocuspocus connection per collaborative
 * session, authenticated with the same OAuth bearer token as the HTTP API
 * (the sidecar validates it against the API). Presence positions go up as
 * stateless messages; the sidecar answers with roster broadcasts and signals
 * whenever the workspace's change feed moves (it watches the feed head once
 * per workspace). On that signal the transport reads the new events through
 * Neos.Api itself - the very feed tail the polling transport runs on an
 * interval - so there is one classifier, Neos.Api's per-node read filtering
 * applies, and remote changes still arrive with sub-second latency without
 * every editor polling.
 *
 * The Yjs document behind the connection
 * (`workspace:<contentRepositoryId>:<workspaceName>`) is unused for
 * now - it is the seam where the planned collaborative text editing (phase 4)
 * attaches without a new connection concept. Awareness is off: presence
 * travels as stateless messages.
 */
export function startWebsocketTransport(
  url: string,
  contentRepositoryId: string,
  workspaceName: string,
  initialPosition: CollaborationPosition,
  callbacks: TransportCallbacks & {
    /** Connection state, driving the bridge's polling fallback. */
    onStatus: (connected: boolean) => void
  },
): CollaborationTransport {
  let position = initialPosition
  let disposed = false
  /** Authenticated right now - losing that opens a gap in the signals. */
  let authenticated = false
  let providerDestroyed = false

  // The feed tail starts right away over HTTP - its baseline does not wait
  // for the socket, so nothing between session start and the first signal
  // is missed.
  const tail = createFeedTail(workspaceName, callbacks)
  tail.tick()

  const connectionLost = () => {
    // Signals are missed from now on: whoever tails next (the polling
    // fallback) must not start from a fresh baseline without a refresh.
    if (authenticated) markRealtimeGap(workspaceName)
    authenticated = false
  }

  // Ours, so stop() can destroy it - the provider leaves a document handed
  // to it alone.
  const ydoc = new Y.Doc()

  const sendPosition = () => {
    try {
      provider.sendStateless(JSON.stringify({ type: 'position', ...position }))
    } catch {
      /* not connected - the sidecar re-requests the position on connect */
    }
  }

  const provider = new HocuspocusProvider({
    url,
    name: `workspace:${contentRepositoryId}:${workspaceName}`,
    document: ydoc,
    awareness: null,
    // Async token: always hands the CURRENT access token to (re)connects, so
    // a connection outliving the 1h token TTL re-authenticates cleanly.
    token: async () => (await getValidAccessToken()) ?? '',
    // Deliberately onAuthenticated, not onConnect: the provider's connect
    // event fires at socket-open BEFORE the token was validated - a session
    // only counts (and the polling fallback only stops) once the sidecar
    // accepted it.
    onAuthenticated() {
      if (disposed) return
      authenticated = true
      clearRealtimeGap(workspaceName)
      // Signals may have passed while disconnected (or before the first
      // connect): catch up from the tail's cursor, which outlived the
      // outage. Events the polling fallback delivered meanwhile may come
      // again - the bridge's updates are idempotent re-renders.
      tail.tick()
      sendPosition()
      callbacks.onStatus(true)
    },
    onStatus({ status }) {
      if (disposed) return
      if (status === WebSocketStatus.Disconnected) {
        connectionLost()
        callbacks.onStatus(false)
      }
    },
    onStateless({ payload }) {
      if (disposed) return
      let message: ServerMessage
      try {
        message = JSON.parse(payload) as ServerMessage
      } catch {
        return
      }
      switch (message.type) {
        case 'presence':
          // No `you` on the wire - the bridge falls back to /me's user id.
          callbacks.onRoster(message.users, null)
          break
        case 'changed':
          // The feed head moved - read what is new (unless an earlier
          // signal's run already got there).
          if (
            !tail.isAt({
              stream: message.contentStreamId,
              sequenceNumber: message.sequenceNumber,
            })
          ) {
            tail.tick()
          }
          break
        case 'liveEdit':
          callbacks.onLiveEdit?.({
            nodeAggregateId: message.nodeAggregateId,
            property: message.property,
            value: message.value,
            cursor: typeof message.cursor === 'number' ? message.cursor : null,
          })
          break
      }
    },
    onAuthenticationFailed({ reason }) {
      if (disposed) return
      // A rejected token or missing workspace permission is not a transient
      // network condition - stop the retry loop and leave the session on the
      // polling fallback (the API re-checks permissions there anyway).
      console.warn(
        `[collaboration] realtime connection rejected (${reason}) - falling back to polling`,
      )
      connectionLost()
      callbacks.onStatus(false)
      destroyProvider()
    },
  })

  // Once only: a rejected connection destroys the provider already, and
  // stop() must not destroy it a second time.
  function destroyProvider() {
    if (providerDestroyed) return
    providerDestroyed = true
    provider.destroy()
  }

  return {
    updatePosition(next) {
      position = next
      sendPosition()
    },
    sendLiveEdit(edit) {
      try {
        provider.sendStateless(JSON.stringify({ type: 'liveEdit', ...edit }))
      } catch {
        /* not connected - live typing is cosmetic, the save will arrive */
      }
    },
    stop() {
      disposed = true
      tail.stop()
      // The session ends - there is no fallback to hand a gap over to.
      clearRealtimeGap(workspaceName)
      // Closing the connection is the leave announcement: the sidecar drops
      // the roster entry on disconnect and broadcasts the shrunk roster.
      destroyProvider()
      ydoc.destroy()
    },
  }
}
