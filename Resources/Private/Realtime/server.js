/**
 * The Neos Studio realtime sidecar: a Hocuspocus WebSocket server carrying
 * the collaboration signals of shared-workspace editing sessions.
 *
 * One connection per editing session, document name `workspace:<name>`:
 *
 * - Authentication: the client hands over its own OAuth bearer token; the
 *   sidecar validates it against the user-scoped Neos API (a baseline read of
 *   the workspace's change feed - 2xx proves both a live token and read
 *   permission on that very workspace) and resolves the user's identity via
 *   /api/me. No secret of its own ever reaches a client.
 *
 * - Presence: clients announce their position ("on this document, focusing
 *   this node") as stateless messages; the sidecar keeps a per-workspace
 *   roster keyed by connection and broadcasts it on every change. A closed
 *   tab disappears with its connection - no TTLs, no heartbeats.
 *
 * - Change feed: the sidecar tails each active workspace's event feed ONCE
 *   via the shared-secret server-to-server endpoint (X-Realtime-Secret,
 *   see Medienreaktor.NeosStudio.realtime.sharedSecret) and fans new events
 *   out to every connection - replacing one API poll per editor per 2s with
 *   one per workspace, at sub-second latency for the editors.
 *
 * The Yjs document behind each connection is unused for now; it is the seam
 * where collaborative text editing (Studio multiplayer phase 4) attaches.
 *
 * Environment:
 *   PORT                   listen port                       (default 1234)
 *   NEOS_BASE_URL          base URL of the Neos installation (default http://127.0.0.1:8080)
 *   NEOS_HOST_HEADER       Host header override, for reaching Neos through
 *                          an internal hostname (e.g. DDEV's `web`)
 *   REALTIME_SHARED_SECRET must equal Medienreaktor.NeosStudio.realtime.sharedSecret
 *   FEED_INTERVAL_MS       feed tail cadence per workspace   (default 1000)
 */

import { Server } from '@hocuspocus/server'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'

const PORT = Number(process.env.PORT ?? 1234)
const NEOS_BASE_URL = (process.env.NEOS_BASE_URL ?? 'http://127.0.0.1:8080').replace(/\/+$/, '')
const NEOS_HOST_HEADER = process.env.NEOS_HOST_HEADER || null
const SHARED_SECRET = process.env.REALTIME_SHARED_SECRET || ''
const FEED_INTERVAL_MS = Math.max(250, Number(process.env.FEED_INTERVAL_MS ?? 1000))
/** Consecutive feed failures before the workspace's connections are dropped
 * (clients then fall back to HTTP polling, which re-checks everything). */
const FEED_FAILURE_LIMIT = 5

if (SHARED_SECRET === '') {
  console.error(
    '[realtime] REALTIME_SHARED_SECRET is not set - it must equal Medienreaktor.NeosStudio.realtime.sharedSecret. Refusing to start.',
  )
  process.exit(1)
}

const workspaceOf = (documentName) =>
  documentName.startsWith('workspace:') ? documentName.slice('workspace:'.length) : null

/**
 * Fetch-alike over node:http - deliberately NOT global fetch(): WHATWG fetch
 * treats Host as a forbidden header and silently strips it, so NEOS_HOST_HEADER
 * would never reach Neos. Redirects are not followed - an API endpoint that
 * redirects (e.g. a non-www rewrite catching the internal hostname) is a
 * misconfiguration better surfaced as a failed probe than silently chased.
 */
const neosFetch = (path, headers = {}) =>
  new Promise((resolve, reject) => {
    if (NEOS_HOST_HEADER) headers = { ...headers, host: NEOS_HOST_HEADER }
    const url = new URL(NEOS_BASE_URL + path)
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      url,
      { headers },
      (response) => {
        let body = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => (body += chunk))
        response.on('end', () =>
          resolve({
            ok: response.statusCode >= 200 && response.statusCode < 300,
            status: response.statusCode,
            json: async () => JSON.parse(body),
          }),
        )
      },
    )
    // A hung connection would otherwise stall the feed's setTimeout chain
    // forever (ticks never overlap by design, they wait for the response).
    request.setTimeout(30_000, () => request.destroy(new Error('request timed out')))
    request.on('error', reject)
    request.end()
  })

/**
 * Per-workspace session state, keyed by document name. Lives exactly as long
 * as the Hocuspocus document (created with the first connection, dropped in
 * afterUnloadDocument when the last one goes).
 */
const sessions = new Map()

const ensureSession = (documentName, document) => {
  let session = sessions.get(documentName)
  if (!session) {
    session = {
      workspace: workspaceOf(documentName),
      document,
      /** socketId -> presence entry; one entry per connection (= per tab). */
      roster: new Map(),
      /** Feed cursor: null until the baseline request adopted a position. */
      cursor: null,
      failures: 0,
      timer: null,
      stopped: false,
    }
    sessions.set(documentName, session)
    startFeed(session)
  }
  return session
}

/**
 * The roster wire format matches the polling presence endpoint's `users`, so
 * the Studio's transport layer needs no translation.
 *
 * Edit-lock ARBITRATION happens here: connections store their DESIRED claim
 * (the element they have selected); per element, the EARLIEST claim wins and
 * only the winner's claim broadcasts as `editingElement`. Recomputed on
 * every broadcast, so a released element auto-promotes the next claimant -
 * whoever selected it while it was held gets the lock the moment the holder
 * moves away, without re-selecting.
 */
const broadcastRoster = (session) => {
  const winners = new Map() // nodeAggregateId -> { socketId, at }
  for (const [socketId, entry] of session.roster) {
    if (!entry.claim) continue
    const current = winners.get(entry.claim.nodeAggregateId)
    if (
      !current ||
      entry.claim.at < current.at ||
      (entry.claim.at === current.at && socketId < current.socketId)
    ) {
      winners.set(entry.claim.nodeAggregateId, { socketId, at: entry.claim.at })
    }
  }
  // Two tabs of the same user collapse into one roster row, mirroring the
  // API's one-entry-per-user semantics - preferring the connection holding
  // a granted claim, so a user's second tab never hides their lock.
  const byUser = new Map()
  for (const [socketId, entry] of session.roster) {
    const row = {
      userId: entry.userId,
      name: entry.name,
      documentAggregateId: entry.documentAggregateId,
      focusedAggregateId: entry.focusedAggregateId,
      dimensionSpacePoint: entry.dimensionSpacePoint,
      editingElement:
        entry.claim && winners.get(entry.claim.nodeAggregateId)?.socketId === socketId
          ? { nodeAggregateId: entry.claim.nodeAggregateId, property: entry.claim.property }
          : null,
      updatedAt: entry.updatedAt,
    }
    const existing = byUser.get(entry.userId)
    const preferRow =
      !existing ||
      (row.editingElement !== null && existing.editingElement === null) ||
      (existing.editingElement === null && row.updatedAt >= existing.updatedAt)
    if (preferRow) byUser.set(entry.userId, row)
  }
  const users = [...byUser.values()].map(({ updatedAt, ...user }) => user)
  session.document.broadcastStateless(JSON.stringify({ type: 'presence', users }))
}

const broadcast = (session, message) =>
  session.document.broadcastStateless(JSON.stringify(message))

// --- Change feed tail --------------------------------------------------------

const feedPath = (workspace, cursor) =>
  `/api/realtime/workspaces/${encodeURIComponent(workspace)}/events` +
  (cursor ? `?stream=${encodeURIComponent(cursor.stream)}&since=${cursor.since}` : '')

const startFeed = (session) => {
  const tick = async () => {
    if (session.stopped) return
    try {
      const response = await neosFetch(feedPath(session.workspace, session.cursor), {
        'X-Realtime-Secret': SHARED_SECRET,
      })
      if (!response.ok) throw new Error(`feed answered ${response.status}`)
      const feed = await response.json()
      session.failures = 0

      if (session.cursor === null) {
        // Baseline: adopt the current position, nothing to replay.
        session.cursor = { stream: feed.contentStreamId, since: feed.sequenceNumber }
      } else if (
        feed.reset ||
        feed.truncated ||
        feed.contentStreamId !== session.cursor.stream
      ) {
        // The workspace content changed wholesale (someone published,
        // discarded or rebased the session) or the feed overflowed -
        // incremental updates cannot describe this.
        session.cursor = { stream: feed.contentStreamId, since: feed.sequenceNumber }
        broadcast(session, { type: 'workspaceChanged' })
      } else {
        session.cursor.since = feed.sequenceNumber
        if (feed.events.length > 0) broadcast(session, { type: 'events', events: feed.events })
      }
    } catch (error) {
      session.failures += 1
      console.warn(
        `[realtime] feed tail for "${session.workspace}" failed (${session.failures}/${FEED_FAILURE_LIMIT}): ${error.message}`,
      )
      if (session.failures >= FEED_FAILURE_LIMIT) {
        // Fail loudly rather than serving presence without events: drop the
        // connections so every client falls back to HTTP polling.
        console.error(
          `[realtime] feed tail for "${session.workspace}" keeps failing - disconnecting its clients`,
        )
        for (const connection of session.document.getConnections()) connection.close()
        return // afterUnloadDocument stops the loop for good
      }
    }
    if (!session.stopped) session.timer = setTimeout(tick, FEED_INTERVAL_MS)
  }
  // setTimeout chain instead of setInterval: ticks never overlap, a slow
  // response simply delays the next one.
  session.timer = setTimeout(tick, 0)
}

const stopFeed = (documentName) => {
  const session = sessions.get(documentName)
  if (!session) return
  session.stopped = true
  if (session.timer !== null) clearTimeout(session.timer)
  sessions.delete(documentName)
}

// --- Server ------------------------------------------------------------------

const server = new Server({
  quiet: true,

  async onAuthenticate({ token, documentName }) {
    const workspace = workspaceOf(documentName)
    if (workspace === null) throw new Error('unknown document namespace')
    if (!token) throw new Error('missing token')

    // One request proves both: the bearer token is alive AND its user may
    // read this very workspace (the events resource re-checks permissions).
    const feedProbe = await neosFetch(
      `/api/workspaces/${encodeURIComponent(workspace)}/events`,
      { authorization: `Bearer ${token}` },
    )
    if (!feedProbe.ok) throw new Error(`workspace access denied (${feedProbe.status})`)

    const meResponse = await neosFetch('/api/me', { authorization: `Bearer ${token}` })
    if (!meResponse.ok) throw new Error(`identity lookup failed (${meResponse.status})`)
    const me = await meResponse.json()
    const userId = me?.user?.id
    if (typeof userId !== 'string') throw new Error('token is not bound to a user')

    // Becomes the connection's server-side context: presence identity is
    // authoritative here, never client-claimed.
    return { userId, name: typeof me.user.label === 'string' ? me.user.label : userId }
  },

  async connected({ documentName, connection, context }) {
    const session = ensureSession(documentName, connection.document)
    session.roster.set(connection.socketId, {
      userId: context.userId,
      name: context.name,
      documentAggregateId: null,
      focusedAggregateId: null,
      dimensionSpacePoint: null,
      /** The DESIRED edit-lock claim: {nodeAggregateId, property, at}. */
      claim: null,
      updatedAt: Date.now(),
    })
    broadcastRoster(session)
  },

  async onStateless({ payload, documentName, connection }) {
    const session = sessions.get(documentName)
    if (!session) return
    let message
    try {
      message = JSON.parse(payload)
    } catch {
      return
    }
    if (message.type === 'position') {
      const entry = session.roster.get(connection.socketId)
      if (!entry) return
      entry.documentAggregateId =
        typeof message.documentAggregateId === 'string' ? message.documentAggregateId : null
      entry.focusedAggregateId =
        typeof message.focusedAggregateId === 'string' ? message.focusedAggregateId : null
      entry.dimensionSpacePoint =
        message.dimensionSpacePoint && typeof message.dimensionSpacePoint === 'object'
          ? message.dimensionSpacePoint
          : null
      // The selected element - the DESIRED edit-lock claim. Stored as-is;
      // broadcastRoster arbitrates (earliest claim per element wins). The
      // claim time survives re-sends of the same element, so a holder's
      // position updates never cost them their seniority.
      if (
        message.editingElement &&
        typeof message.editingElement.nodeAggregateId === 'string'
      ) {
        const nodeAggregateId = message.editingElement.nodeAggregateId
        entry.claim = {
          nodeAggregateId,
          property:
            typeof message.editingElement.property === 'string'
              ? message.editingElement.property
              : null,
          at:
            entry.claim?.nodeAggregateId === nodeAggregateId
              ? entry.claim.at
              : Date.now(),
        }
      } else {
        entry.claim = null
      }
      entry.updatedAt = Date.now()
      broadcastRoster(session)
      return
    }
    if (message.type === 'liveEdit') {
      // The live-typing stream: relay the sender's current text to everyone
      // else in the workspace. Ephemeral and cosmetic - persistence flows
      // through the API and the change feed like any other edit.
      if (
        typeof message.nodeAggregateId !== 'string' ||
        typeof message.property !== 'string' ||
        typeof message.value !== 'string'
      ) {
        return
      }
      session.document.broadcastStateless(
        JSON.stringify({
          type: 'liveEdit',
          nodeAggregateId: message.nodeAggregateId,
          property: message.property,
          value: message.value,
          // The sender's caret position, for the collaborators' caret line.
          cursor: typeof message.cursor === 'number' ? message.cursor : null,
        }),
        (target) => target !== connection,
      )
    }
  },

  async onDisconnect({ documentName, socketId }) {
    const session = sessions.get(documentName)
    if (!session) return
    session.roster.delete(socketId)
    broadcastRoster(session)
  },

  async afterUnloadDocument({ documentName }) {
    stopFeed(documentName)
  },
})

server.listen(PORT).then(() => {
  console.log(
    `[realtime] listening on :${PORT}, tailing feeds at ${NEOS_BASE_URL} every ${FEED_INTERVAL_MS}ms`,
  )
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.destroy().finally(() => process.exit(0))
  })
}
