import type { NodeAddress, Workspace } from '../neos/schema'

/**
 * The models of the Studio's own endpoints (/neos/studio/api): tasks,
 * notifications, preview links, access roles, the workspace review, history
 * and trash, and the presence roster of the realtime sidecar. Nodes and
 * workspaces in them have the shapes of Neos.Api's schema.
 */

/** A workspace's status, as Neos.Api's Workspace has it. */
export type WorkspaceStatus = Workspace['status']

export type TaskStatus = 'OPEN' | 'IN_REVIEW' | 'DONE'

/**
 * One task, as served by GET /tasks: a shared workspace (the task branch)
 * plus the Studio's sidecar record.
 */
export interface Task {
  workspaceName: string
  status: TaskStatus
  assignee: string | null
  createdBy: string | null
  createdAt: string
  commentCount: number
  /** The task's workspace (Neos.Api's Workspace schema); null if stale. */
  workspace: Workspace | null
  /** Whether the account may publish the task workspace (write on its base). */
  canPublish: boolean
}

/** One comment on a task, as served by GET /api/tasks/{name}/comments. */
export interface TaskComment {
  id: number
  author: string | null
  /** Resolved server-side, so it never depends on the users listing. */
  authorLabel: string | null
  text: string
  createdAt: string
}

export interface CreateTaskInput {
  title: string
  description?: string
  baseWorkspace?: string
  assignee?: string
}

export interface UpdateTaskInput {
  title: string
  description?: string
}

/**
 * A notification addressed to the current user, produced server-side by any
 * package through Medienreaktor.NeosStudio's NotificationService. `type` is a
 * producer-namespaced discriminator (e.g. "taskWorkflow.assigned"), `payload`
 * carries structured data whose shape only the producer knows.
 */
export interface StudioNotification {
  id: string
  source: string
  type: string
  title: string
  message: string
  payload: Record<string, unknown>
  createdAt: string
  readAt: string | null
}

/** GET /notifications. */
export interface NotificationsResponse {
  notifications: StudioNotification[]
  unreadCount: number
}

/**
 * One shareable preview link, as served by GET /preview-links: a URL secret
 * granting anonymous, read-only, frontend-mode access to one document (the
 * address fields) until the link expires. The secret is stored hashed, so
 * the URL exists exactly once - in the create response.
 */
export interface PreviewLink extends NodeAddress {
  id: string
  label: string
  createdAt: string
  expiresAt: string
}

/** The create response carries the one-time full URL on top. */
export interface CreatedPreviewLink extends PreviewLink {
  shareUrl: string
}

/** One page-tree rule: allow or deny a document, by default including everything below it. */
export interface NodeTreeRule {
  mode: 'ALLOW' | 'DENY'
  /** The site the document belongs to - groups the rules in the UI. */
  siteNodeName: string
  nodeAggregateId: string
  /** Denormalised at pick time, for listing a role without resolving nodes. */
  label: string
  path: string
  /** false narrows the rule to exactly this one document. */
  includeDescendants: boolean
}

/** Capability names the server currently knows; the listing endpoint reports them. */
export type AccessCapability =
  'editNodes' | 'createNodes' | 'deleteNodes' | 'moveNodes'

export interface AccessRoleConstraints {
  /** Empty = every site. */
  siteNodeNames: string[]
  /** Empty = the whole page tree. */
  nodeTreeRules: NodeTreeRule[]
  /** dimension id => allowed values; an absent key means every value. */
  dimensionValues: Record<string, string[]>
  /** Shared workspaces the role may use; empty = all of them. */
  workspaceNames: string[]
  allowPersonalWorkspace: boolean
  allowPublishToLive: boolean
  allowWorkspaceCreation: boolean
  /** Only withheld capabilities are listed (value false); absent = granted. */
  capabilities: Partial<Record<AccessCapability, boolean>>
}

export interface AccessRole {
  id: string
  identifier: string
  label: string
  description: string
  active: boolean
  /** Whether the role narrows anything at all - drives the "unrestricted" badge. */
  restricting: boolean
  constraints: AccessRoleConstraints
  memberUserIds: string[]
  createdAt: string
  updatedAt: string
}

export interface AccessRolesResponse {
  roles: AccessRole[]
  capabilities: AccessCapability[]
  /** Flow roles exempt from access control - administrators by default. */
  bypassRoles: string[]
  /** False = the roles only shape the UI, the write path is not narrowed. */
  enforcedInContentRepository: boolean
}

/** One role as it reaches an editor through /access/me - no membership, no metadata. */
export interface EffectiveAccessRole {
  id: string
  identifier: string
  label: string
  constraints: AccessRoleConstraints
}

export interface EffectiveAccess {
  /** True for administrators and for users without any assigned role. */
  unrestricted: boolean
  reason: string
  /**
   * The assigned roles, each complete. Roles are additive and every question
   * is answered by OR-ing them, which cannot be expressed as one merged
   * constraint set - a merged page-tree rule list would let one role's DENY
   * cut into a branch another role grants.
   */
  roles: EffectiveAccessRole[]
  /**
   * Node aggregate ids of every ancestor of every granted branch. They are
   * not granted themselves, but the tree shows them read-only anyway - a role
   * granting "Products / Pumps" grants neither "Products" nor the site node,
   * and hiding those would leave the editor with an empty tree and no way
   * down to the one branch they may edit. Resolved server-side per request,
   * because ancestry changes whenever a page is moved.
   */
  pathAnchors: string[]
}

export interface MyAccessResponse {
  access: EffectiveAccess
  capabilities: AccessCapability[]
  /** Whether the caller may administer the access roles themselves. */
  canAdminister?: boolean
}

export interface AccessRoleInput {
  label?: string
  description?: string
  identifier?: string
  constraints?: AccessRoleConstraints
  memberUserIds?: string[]
  active?: boolean
}

/**
 * A changed document as the review dialog lists it: the changes of a workspace
 * grouped by their containing document, enriched for display. The four change
 * flags describe the document node's own change (a page created/moved/deleted);
 * `changed` is also true when only content inside the page changed.
 */
export interface WorkspaceDocumentChange {
  documentAggregateId: string
  /** The document, for navigation; null for a deleted (non-navigable) document. */
  documentAddress: NodeAddress | null
  siteAggregateId: string | null
  siteLabel: string | null
  label: string
  nodeType: string | null
  /** Configured Font Awesome icon name, or null to fall back to a type icon. */
  icon: string | null
  /** Document ancestor labels from the site down to this document (inclusive). */
  breadcrumb: string[]
  created: boolean
  changed: boolean
  moved: boolean
  deleted: boolean
  hidden: boolean
  /** Number of pending changes grouped under this document. */
  changeCount: number
}

/**
 * One event of a workspace's pending history (see the pending-events
 * resource): an ESCR event recorded in the workspace's current content
 * stream - which exists exactly since the workspace last forked off its base,
 * so the list is "everything that happened since the branch point". Enriched
 * server-side with the affected node's label/type/icon and the initiating
 * user's name for display.
 */
export interface WorkspacePendingEvent {
  /** Global event-store sequence number - unique and ascending. */
  sequenceNumber: number
  /**
   * The event's 0-based position within its content stream - comparable with
   * a fork's `forkedFrom.version` to locate a branch point in the base.
   */
  version: number
  /** Event short type, e.g. "NodePropertiesWereSet". */
  type: string
  kind: 'content' | 'structure'
  nodeAggregateId: string | null
  parentNodeAggregateId: string | null
  dimensionSpacePoints: Record<string, string>[]
  /**
   * The subtree tag a SubtreeWasTagged/SubtreeWasUntagged event carries, null
   * for every other type: "removed" is a deletion (a soft removal), "disabled"
   * a hide - the same event type for two different user actions.
   */
  tag: string | null
  initiatingUserId: string | null
  initiatingUserLabel: string | null
  recordedAt: string
  /** Label of the affected node; null when it is no longer resolvable. */
  nodeLabel: string | null
  nodeType: string | null
  /** Configured Font Awesome icon of the node's type, or null. */
  icon: string | null
  /**
   * Short class name of the command that caused the event (e.g.
   * "SetSerializedNodeProperties"), from the rebase metadata the content
   * repository keeps on every event. All events of one command share one
   * `initiatingTimestamp` - together with the user that identifies one
   * editing step, and unlike the events' correlation id it survives
   * rebases and partial publishes.
   */
  command: string | null
  initiatingTimestamp: string | null
  /** Closest containing document of the affected node. */
  documentAggregateId: string | null
  documentLabel: string | null
  /** That document, for navigation. */
  documentAddress: NodeAddress | null
}

/**
 * One before/after row of a pending-events diff: what a single event changed.
 * `old`/`new` carry the serialized property value, `{id,label}` node
 * descriptors (reference/parent kinds), a type/tag name, or dimension
 * coordinates (variant kind) - null means "did not exist".
 */
export interface WorkspacePendingDiffChange {
  kind:
    | 'property'
    | 'reference'
    | 'nodeType'
    | 'name'
    | 'parent'
    | 'position'
    | 'tag'
    | 'variant'
  property: string | null
  /** Configured property label - possibly an XLIFF shorthand to translate. */
  label: string | null
  old: unknown
  new: unknown
}

export type WorkspacePendingDiffEvent = WorkspacePendingEvent & {
  changes: WorkspacePendingDiffChange[]
}

/**
 * One changed node of a document's NET diff against the base workspace: the
 * squashed "what publishing applies" view (five edits of one text = one
 * old -> new row). Shares the change-row vocabulary of the pending-events
 * diff, so both render the same way.
 */
export interface WorkspaceDocumentDiffNode {
  nodeAggregateId: string
  dimensions: Record<string, string>
  /**
   * "variant" is a dimension variant added on top of content the base
   * workspace already has - Neos' change projection marks it as created like a
   * brand-new node, the resource tells the two apart by the base workspace.
   */
  status: 'created' | 'removed' | 'moved' | 'changed' | 'variant'
  nodeLabel: string | null
  nodeType: string | null
  icon: string | null
  changes: WorkspacePendingDiffChange[]
}

export interface WorkspacePendingEvents {
  workspace: string
  baseWorkspaceName: string | null
  status: WorkspaceStatus
  contentStreamId: string
  /**
   * Where this workspace's stream branched off: the base's content stream and
   * the version it had at that moment. Base events with a higher version
   * happened after the fork - they are what makes the workspace OUTDATED.
   * null for root workspaces (nothing to fork from).
   */
  forkedFrom: { contentStreamId: string; version: number } | null
  /** Older events were dropped - only the newest ones are listed. */
  truncated: boolean
  /** Oldest first. */
  events: WorkspacePendingEvent[]
}

/**
 * One entry of a workspace's trash bin: a node deleted in it. Deleting is a
 * soft removal, so the node is intact until the deletion is published and the
 * content repository erases it in live - which is what makes restoring it
 * possible at all.
 */
export interface WorkspaceTrashItem {
  nodeAggregateId: string
  /**
   * Address of the deleted node in this workspace and the first dimension it
   * was deleted in. Reads of it must opt into deleted nodes (`includeRemoved`),
   * which is what selecting a trash entry to look at the page does.
   */
  nodeAddress: NodeAddress | null
  /** Label of the deleted node, or its node type name as a fallback. */
  label: string
  nodeType: string
  /** Configured Font Awesome icon of the node's type, or null. */
  icon: string | null
  /**
   * Deleted pages vs. deleted content elements - both share the resource
   * unless it is asked for the pages alone (`documentsOnly`).
   */
  isDocument: boolean
  /** Site node down to the deleted node itself (drop the last entry for its location). */
  breadcrumb: string[]
  siteAggregateId: string | null
  siteLabel: string | null
  /** Every dimension space point the node is deleted in. */
  dimensions: Record<string, string>[]
  /** When it was deleted (ISO), or null when the projection has no timestamp. */
  deletedAt: string | null
  /** Who deleted it, or null for a system/unknown user. */
  deletedBy: string | null
  /**
   * Deleted ancestors a restore brings back along with the node - it would
   * stay invisible inside a deleted parent otherwise.
   */
  restoresAncestors: { nodeAggregateId: string; label: string | null }[]
}

export interface WorkspaceTrashResponse {
  workspace: string
  /** Restoring requires up_to_date - an outdated workspace must synchronize first. */
  status: WorkspaceStatus
  items: WorkspaceTrashItem[]
  /** true when more is deleted than the resource lists at once. */
  truncated: boolean
}

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

/** GET /workspaces/{name}/document-changes. */
export interface WorkspaceDocumentChanges {
  workspace: string
  baseWorkspaceName: string | null
  status: WorkspaceStatus
  documents: WorkspaceDocumentChange[]
}

/** GET /workspaces/{name}/document-diff: one document's net diff against the base. */
export interface WorkspaceDocumentDiff {
  workspace: string
  baseWorkspaceName: string | null
  documentAggregateId: string
  nodes: WorkspaceDocumentDiffNode[]
}

/** GET /workspaces/{name}/pending-events/diff: before/after of a slice of the history. */
export interface WorkspacePendingEventsDiff {
  workspace: string
  contentStreamId: string
  from: number
  to: number
  events: WorkspacePendingDiffEvent[]
}

/**
 * A conflicting node of a failed rebase or publish, resolved in the workspace
 * (deleted nodes included, falling back to the base) - Neos.Api names
 * conflicts by id only. GET /workspaces/{name}/conflict-details.
 */
export interface ConflictNodeDetail {
  nodeAggregateId: string
  nodeLabel: string | null
  documentAggregateId: string | null
  documentLabel: string | null
  documentAddress: NodeAddress | null
}
