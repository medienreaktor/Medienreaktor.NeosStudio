import type { components } from '../../neos/schema/openapi'

/**
 * The models of the Studio's operations of the Neos API, by the names its
 * OpenAPI document gives them - generated with Neos.Api's into
 * api/neos/schema/openapi.ts (`npm run api:schema`). The shell uses these
 * types as they are, without mapping them into models of its own.
 */
type Schemas = components['schemas']

// Tasks
export type Task = Schemas['Task']
export type TaskStatus = Schemas['TaskStatus']
export type TaskComment = Schemas['TaskComment']
export type TaskCreate = Schemas['TaskCreate']
export type TaskUpdate = Schemas['TaskUpdate']

// Notifications
export type StudioNotification = Schemas['Notification']
export type PaginatedNotificationListing =
  Schemas['PaginatedNotificationListing']

// Preview links
export type PreviewLink = Schemas['PreviewLink']
export type NewPreviewLink = Schemas['NewPreviewLink']

// Access roles and the caller's own access
export type AccessRole = Schemas['AccessRole']
export type AccessRoleConstraints = Schemas['AccessRoleConstraints']
export type AccessRoleCreate = Schemas['AccessRoleCreate']
export type AccessRoleUpdate = Schemas['AccessRoleUpdate']
export type AccessRoleListing = Schemas['AccessRoleListing']
export type NodeTreeRule = AccessRoleConstraints['nodeTreeRules'][number]
export type AccessCapability = Schemas['AccessCapabilityList'][number]
export type EffectiveAccessRole = Schemas['EffectiveAccessRole']
/**
 * Where the caller's access roles let them work. The roles come one by one:
 * every question is answered by OR-ing them, which one merged set of
 * constraints couldn't express. features/access/rules.ts evaluates them.
 */
export type MyAccess = Schemas['MyAccess']
export type EffectiveAccess = MyAccess

// Creating a node through its creation dialog
export type CreationDialogNodeCreate = Schemas['CreationDialogNodeCreate']

/**
 * A change of a workspace, as the collaboration feed hands it on: an event of
 * its content stream, classified - from the realtime sidecar
 * (RealtimeController), or polled from Neos.Api's workspace events and
 * classified the same way client-side (features/collaboration/eventFeed.ts).
 * Not part of the Studio API.
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
 * there are no locks, by design. Not part of the Studio API.
 */
export interface EditingElement {
  nodeAggregateId: string
  property: string | null
}

/** One user on the realtime sidecar's presence roster. Not part of the Studio API. */
export interface PresenceUser {
  userId: string
  name: string
  documentAggregateId: string | null
  focusedAggregateId: string | null
  dimensionSpacePoint: Record<string, string> | null
  editingElement?: EditingElement | null
}
