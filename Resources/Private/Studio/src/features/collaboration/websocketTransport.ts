import { HocuspocusProvider, WebSocketStatus } from '@hocuspocus/provider'
import type { PresenceUser, WorkspaceFeedEvent } from '@/api/collaboration'
import { getValidAccessToken } from '@/auth/oauth'
import type { LiveEdit } from './liveEdits'
import type {
  CollaborationPosition,
  CollaborationTransport,
  TransportCallbacks,
} from './transport'

/**
 * Messages the realtime sidecar (Resources/Private/Realtime/server.js) sends over the stateless
 * channel of the Hocuspocus connection. The shapes deliberately mirror the
 * polling endpoints' payloads so both transports feed the bridge identically.
 */
type ServerMessage =
  | { type: 'presence'; users: PresenceUser[] }
  | { type: 'events'; events: WorkspaceFeedEvent[] }
  | { type: 'workspaceChanged' }
  | ({ type: 'liveEdit' } & LiveEdit)

/**
 * The WebSocket transport: one Hocuspocus connection per collaborative
 * session, authenticated with the same OAuth bearer token as the HTTP API
 * (the sidecar validates it against the API). Presence positions go up as
 * stateless messages; the sidecar answers with roster broadcasts and fans out
 * the workspace change feed it tails server-side - so an editing session
 * causes ONE feed poll per workspace on the sidecar instead of one per
 * editor per 2s, and remote changes arrive with sub-second latency.
 *
 * The Yjs document behind the connection (`workspace:<name>`) is unused for
 * now - it is the seam where the planned collaborative text editing (phase 4)
 * attaches without a new connection concept.
 */
export function startWebsocketTransport(
  url: string,
  workspaceName: string,
  initialPosition: CollaborationPosition,
  callbacks: TransportCallbacks & {
    /** Connection state, driving the bridge's polling fallback. */
    onStatus: (connected: boolean) => void
  },
): CollaborationTransport {
  let position = initialPosition
  let disposed = false
  let everConnected = false

  const sendPosition = () => {
    try {
      provider.sendStateless(JSON.stringify({ type: 'position', ...position }))
    } catch {
      /* not connected - the sidecar re-requests the position on connect */
    }
  }

  const provider = new HocuspocusProvider({
    url,
    name: `workspace:${workspaceName}`,
    // Async token: always hands the CURRENT access token to (re)connects, so
    // a connection outliving the 1h token TTL re-authenticates cleanly.
    token: async () => (await getValidAccessToken()) ?? '',
    // Deliberately onAuthenticated, not onConnect: the provider's connect
    // event fires at socket-open BEFORE the token was validated - a session
    // only counts (and the polling fallback only stops) once the sidecar
    // accepted it.
    onAuthenticated() {
      if (disposed) return
      if (everConnected) {
        // Events may have passed while disconnected - incremental updates
        // cannot bridge the gap, refresh wholesale (same remedy as a
        // truncated poll response).
        callbacks.onWorkspaceChanged()
      }
      everConnected = true
      sendPosition()
      callbacks.onStatus(true)
    },
    onStatus({ status }) {
      if (disposed) return
      if (status === WebSocketStatus.Disconnected) callbacks.onStatus(false)
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
        case 'events':
          if (message.events.length > 0) callbacks.onEvents(message.events)
          break
        case 'workspaceChanged':
          callbacks.onWorkspaceChanged()
          break
        case 'liveEdit':
          callbacks.onLiveEdit?.({
            nodeAggregateId: message.nodeAggregateId,
            property: message.property,
            value: message.value,
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
      callbacks.onStatus(false)
      provider.destroy()
    },
  })

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
      // Closing the connection is the leave announcement: the sidecar drops
      // the roster entry on disconnect and broadcasts the shrunk roster.
      provider.destroy()
    },
  }
}
