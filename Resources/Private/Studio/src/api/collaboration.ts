import { apiFetch } from './client'

/**
 * The collaboration transport: plain HTTP polling against two endpoints (the
 * workspace change feed and the presence heartbeat). Deliberately NOT
 * TanStack queries - the feed is a cursor over an append-only log and the
 * heartbeat is a write that answers with the roster; neither is cacheable
 * server state. The CollaborationBridge drives both on intervals.
 */

export interface WorkspaceFeedEvent {
  /** Global event-store sequence number - the feed cursor. */
  sequenceNumber: number
  /** Event short type, e.g. "NodePropertiesWereSet". */
  type: string
  /**
   * How a client should react: 'content' = a node's rendered element changed
   * (re-render it in place), 'structure' = the tree changed shape.
   */
  kind: 'content' | 'structure'
  nodeAggregateId: string | null
  /** The collection a structural change happened inside, when known. */
  parentNodeAggregateId: string | null
  /** Affected dimension space points; empty = affects every dimension. */
  dimensionSpacePoints: Record<string, string>[]
  /** The Neos user id that caused the event (compare with me.user.id). */
  initiatingUserId: string | null
  recordedAt: string
}

export interface WorkspaceEventsResponse {
  workspace: string
  contentStreamId: string
  /** The cursor to poll from next. */
  sequenceNumber: number
  /**
   * The workspace moved to a different content stream since the client's
   * cursor (publish/discard/rebase) - its content changed wholesale.
   */
  reset: boolean
  /** The page was full - more events exist than the response carries. */
  truncated: boolean
  events: WorkspaceFeedEvent[]
}

/** One tail request; pass null cursor for the baseline (no events, just the
 * current position to start tailing from). */
export function fetchWorkspaceEvents(
  workspaceName: string,
  cursor: { stream: string; since: number } | null,
): Promise<WorkspaceEventsResponse> {
  const query = cursor
    ? `?stream=${encodeURIComponent(cursor.stream)}&since=${cursor.since}`
    : ''
  return apiFetch(
    `/workspaces/${encodeURIComponent(workspaceName)}/events${query}`,
  )
}

/**
 * The content element a user has claimed - peers see it locked. Claimed by
 * SELECTING the element (documents are never claimed); property names the
 * inline text being typed in when known, for badge placement.
 *
 * Edit locks are a Studio/sidecar concept, NOT an API one: claims travel
 * exclusively over the realtime sidecar's roster. The REST API's presence
 * endpoint knows nothing about them - without the sidecar there are no
 * locks, by design.
 */
export interface EditingElement {
  nodeAggregateId: string
  property: string | null
}

export interface PresenceUser {
  userId: string
  name: string
  documentAggregateId: string | null
  focusedAggregateId: string | null
  dimensionSpacePoint: Record<string, string> | null
  /** Sidecar rosters only; absent in the API's presence responses. */
  editingElement?: EditingElement | null
}

export interface PresenceResponse {
  workspace: string
  /** The heartbeating user's own id, for filtering self from the roster. */
  you: string
  users: PresenceUser[]
}

/**
 * Announce presence in the workspace and receive everyone currently there.
 * `leave: true` removes the own entry immediately (otherwise it expires 30s
 * after the last beat).
 */
export function sendPresenceHeartbeat(
  workspaceName: string,
  body: {
    documentAggregateId?: string | null
    focusedAggregateId?: string | null
    dimensionSpacePoint?: Record<string, string> | null
    leave?: boolean
  },
): Promise<PresenceResponse> {
  return apiFetch(`/workspaces/${encodeURIComponent(workspaceName)}/presence`, {
    method: 'POST',
    body,
  })
}
