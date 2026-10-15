/**
 * The collaboration feed's own models: what the realtime sidecar and the
 * polling transport hand the shell. None of them is part of the Neos API.
 */

/**
 * A change of a workspace, as the collaboration feed hands it on: an event of
 * its content stream, classified - from the realtime sidecar
 * (RealtimeController), or polled from Neos.Api's workspace events and
 * classified the same way client-side (features/collaboration/eventFeed.ts).
 */
export interface WorkspaceFeedEvent {
  /** Global event-store sequence number - the feed cursor. */
  sequenceNumber: number
  /** The event's 0-based position within its content stream. */
  version: number
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
  /** The subtree tag of a Subtree(Un)Tagged event ("removed", "disabled"). */
  tag: string | null
  /** The Neos user id that caused the event (compare with me.user.id). */
  initiatingUserId: string | null
  recordedAt: string
  /** Short class name of the originating command, when recorded. */
  command: string | null
  initiatingTimestamp: string | null
}

/**
 * The content element a user has claimed - peers see it locked. Claimed by
 * SELECTING the element (documents are never claimed); property names the
 * inline text being typed in when known, for badge placement.
 *
 * Edit locks - like presence as a whole - travel exclusively over the
 * realtime sidecar's roster: without the sidecar there is no presence and
 * there are no locks, by design.
 */
export interface EditingElement {
  nodeAggregateId: string
  property: string | null
}

/** One user on the realtime sidecar's presence roster. */
export interface PresenceUser {
  userId: string
  name: string
  documentAggregateId: string | null
  focusedAggregateId: string | null
  dimensionSpacePoint: Record<string, string> | null
  editingElement?: EditingElement | null
}
