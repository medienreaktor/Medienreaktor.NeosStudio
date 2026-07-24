import { useQueries, useQuery } from '@tanstack/react-query'
import { apiFetch, ApiError } from './client'
import { queryKeys } from './keys'

export interface Workspace {
  name: string
  baseWorkspace: string | null
  title: string
  description: string
  classification: string
  owner: string | null
  hasPublishableChanges: boolean
  /** OUTDATED = the base workspace has newer changes; a rebase would pull them in. */
  status: 'UP_TO_DATE' | 'OUTDATED'
  /**
   * The account's permissions on this workspace. `manage` covers workspace
   * metadata and role changes (not publishing); `publish` is derived - it
   * means write access on the base workspace, which is what the content
   * repository checks when publishing.
   */
  permissions: {
    read: boolean
    write: boolean
    manage: boolean
    publish: boolean
  }
}

export interface WorkspaceChange {
  nodeAggregateId: string
  /** Closest containing document (the node itself if it is a document). */
  documentAggregateId: string | null
  /**
   * Closest containing site, for scoping counts/publish to one site. null for
   * deleted nodes (no longer resolvable in the subgraph).
   */
  siteAggregateId: string | null
  originDimensionSpacePoint: Record<string, string> | null
  created: boolean
  changed: boolean
  moved: boolean
  deleted: boolean
}

/**
 * How many distinct nodes a change list touches. The changes resource returns
 * one entry per node AND dimension (a move fans out per covered dimension
 * space point) - UIs that show no dimensions count nodes, or a single move of
 * a node existing in two languages would read as two changes.
 */
export function countChangedNodes(changes: WorkspaceChange[]): number {
  return new Set(changes.map((change) => change.nodeAggregateId)).size
}

export function useWorkspaces(enabled = true, refetchInterval?: number) {
  return useQuery({
    queryKey: queryKeys.workspaces.all,
    queryFn: () => apiFetch<{ workspaces: Workspace[] }>('/workspaces'),
    enabled,
    refetchInterval,
  })
}

/**
 * Scopes a publish/discard; empty = whole workspace. `site` / `document` scope
 * to one aggregate; `documents` scopes to a selection of documents (the review
 * dialog) - published/discarded one by one on the server. When several are set
 * the server prefers `documents`, then `site`, then `document`.
 */
export interface WorkspaceOperationFilter {
  site?: string
  document?: string
  documents?: string[]
}

/** Publish pending changes of the workspace to its base workspace. */
export function publishWorkspace(
  workspaceName: string,
  filter?: WorkspaceOperationFilter,
): Promise<{ workspace: string; publishedChanges: number }> {
  return apiFetch(`/workspaces/${encodeURIComponent(workspaceName)}/publish`, {
    method: 'POST',
    body: filter,
  })
}

/**
 * Rebase the workspace onto the current state of its base workspace - what
 * the classic UI calls "synchronize": changes published by others flow in
 * underneath the workspace's own pending changes. Rejected with a 409 and
 * error code "rebase_conflicts" when own changes collide with the incoming
 * ones; retrying with force drops the conflicting own changes.
 */
export function rebaseWorkspace(
  workspaceName: string,
  strategy?: 'force',
): Promise<{ workspace: string; rebased: boolean }> {
  return apiFetch(`/workspaces/${encodeURIComponent(workspaceName)}/rebase`, {
    method: 'POST',
    body: strategy ? { strategy } : {},
  })
}

/** Discard pending changes of the workspace. */
export function discardWorkspace(
  workspaceName: string,
  filter?: WorkspaceOperationFilter,
): Promise<{ workspace: string; discardedChanges: number }> {
  return apiFetch(`/workspaces/${encodeURIComponent(workspaceName)}/discard`, {
    method: 'POST',
    body: filter,
  })
}

/**
 * Rebase the workspace onto a different base workspace - what "switching the
 * workspace" means in Neos: editing always happens in the personal workspace,
 * this only retargets where its changes get published. Rejected with a 409
 * and error code "workspace_not_empty" while the workspace still has
 * publishable changes.
 */
export function changeBaseWorkspace(
  workspaceName: string,
  baseWorkspace: string,
): Promise<{ workspace: string; baseWorkspace: string }> {
  return apiFetch(
    `/workspaces/${encodeURIComponent(workspaceName)}/base-workspace`,
    { method: 'POST', body: { baseWorkspace } },
  )
}

/** One conflicting change surfaced by a failed rebase/publish (see the API's
 * 409 response). Labels/address are best-effort and may be null. */
export interface RebaseConflict {
  nodeAggregateId: string | null
  nodeLabel: string | null
  documentAggregateId: string | null
  documentLabel: string | null
  /** Encoded node address of the affected document, for navigation. */
  documentAddress: string | null
  siteAggregateId: string | null
  typeOfChange: 'created' | 'changed' | 'moved' | 'deleted' | null
  reason: 'node_has_been_deleted' | null
  /** Raw exception message from the content repository, as a fallback. */
  message: string
}

export interface RebaseConflicts {
  /**
   * 'rebase_conflicts' - own changes collide with the base; forcing drops them.
   * 'partial_publish_conflicts' - the scoped selection can't be reordered out
   * of the rest; forcing does not help, a different scope / full publish does.
   */
  code: 'rebase_conflicts' | 'partial_publish_conflicts'
  conflicts: RebaseConflict[]
}

/**
 * Extract the structured conflicts from a 409 ApiError, or null if the error is
 * not a workspace conflict (so callers can fall back to a generic error toast).
 */
export function getRebaseConflicts(error: unknown): RebaseConflicts | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null
  const body = error.body
  if (typeof body !== 'object' || body === null) return null
  const code = (body as { error?: string }).error
  if (code !== 'rebase_conflicts' && code !== 'partial_publish_conflicts') {
    return null
  }
  const conflicts = (body as { conflicts?: RebaseConflict[] }).conflicts ?? []
  return { code, conflicts }
}

/**
 * A changed document as the review dialog lists it: the changes of a workspace
 * grouped by their containing document, enriched for display. The four change
 * flags describe the document node's own change (a page created/moved/deleted);
 * `changed` is also true when only content inside the page changed.
 */
export interface WorkspaceDocumentChange {
  documentAggregateId: string
  /** Encoded node address for navigation; null for a deleted (non-navigable) document. */
  documentAddress: string | null
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

export function useWorkspaceDocumentChanges(
  workspaceName: string | null,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.workspaces.documentChanges(workspaceName ?? ''),
    queryFn: () =>
      apiFetch<{
        workspace: string
        baseWorkspace: string | null
        status: 'UP_TO_DATE' | 'OUTDATED'
        documents: WorkspaceDocumentChange[]
      }>(`/workspaces/${encodeURIComponent(workspaceName!)}/document-changes`),
    enabled: workspaceName !== null && enabled,
  })
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
  /** Encoded node address of that document - navigable via the studio. */
  documentAddress: string | null
}

/**
 * One editing step of a workspace's pending history: the events one command
 * produced (a paste, a property change, a move...), the unit the Workspaces
 * graph draws as a single commit dot. Grouped client-side from consecutive
 * events sharing command, user and initiating timestamp.
 */
export interface WorkspacePendingStep {
  /** The first event's sequence number - stable id of the step. */
  id: number
  command: string | null
  /** Oldest first; never empty. */
  events: WorkspacePendingEvent[]
  /** Sequence-number range, for the diff resource. */
  from: number
  to: number
  /** Stream version of the last event - what fork points compare against. */
  version: number
  initiatingUserLabel: string | null
  recordedAt: string
  /** The distinct documents the step touched (label of the first event wins). */
  documents: { id: string; label: string | null; address: string | null }[]
}

/**
 * Group a pending history (oldest first) into editing steps. Events of one
 * command commit contiguously, so grouping consecutive runs is exact; the
 * guard on command/timestamp presence keeps unknown events as single steps.
 */
export function groupPendingEvents(
  events: WorkspacePendingEvent[],
): WorkspacePendingStep[] {
  const steps: WorkspacePendingStep[] = []
  let current: WorkspacePendingStep | null = null
  for (const event of events) {
    const joins =
      current !== null &&
      current.command !== null &&
      event.command === current.command &&
      event.initiatingTimestamp !== null &&
      event.initiatingTimestamp === current.events[0].initiatingTimestamp &&
      event.initiatingUserId === current.events[0].initiatingUserId
    if (joins && current !== null) {
      current.events.push(event)
      current.to = event.sequenceNumber
      current.version = event.version
      current.recordedAt = event.recordedAt
      if (
        event.documentAggregateId !== null &&
        !current.documents.some((d) => d.id === event.documentAggregateId)
      ) {
        current.documents.push({
          id: event.documentAggregateId,
          label: event.documentLabel,
          address: event.documentAddress,
        })
      }
    } else {
      current = {
        id: event.sequenceNumber,
        command: event.command,
        events: [event],
        from: event.sequenceNumber,
        to: event.sequenceNumber,
        version: event.version,
        initiatingUserLabel: event.initiatingUserLabel,
        recordedAt: event.recordedAt,
        documents:
          event.documentAggregateId !== null
            ? [
                {
                  id: event.documentAggregateId,
                  label: event.documentLabel,
                  address: event.documentAddress,
                },
              ]
            : [],
      }
      steps.push(current)
    }
  }
  return steps
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
  status: 'created' | 'removed' | 'moved' | 'changed'
  nodeLabel: string | null
  nodeType: string | null
  icon: string | null
  changes: WorkspacePendingDiffChange[]
}

/**
 * The net state diff of one document's changed nodes (workspace vs base).
 * Lazy: fetched when a review row is unfolded.
 */
export function useWorkspaceDocumentDiff(
  workspaceName: string | null,
  documentAggregateId: string | null,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.workspaces.documentDiff(
      workspaceName ?? '',
      documentAggregateId ?? '',
    ),
    queryFn: () =>
      apiFetch<{
        workspace: string
        baseWorkspace: string | null
        documentAggregateId: string
        nodes: WorkspaceDocumentDiffNode[]
      }>(
        `/workspaces/${encodeURIComponent(workspaceName!)}/document-diff?documentAggregateId=${encodeURIComponent(documentAggregateId!)}`,
      ),
    enabled: enabled && workspaceName !== null && documentAggregateId !== null,
    // Mirrors the changes queries: state diffs go stale with further edits.
    staleTime: 10_000,
  })
}

/**
 * Before/after detail for one editing step (a sequence-number slice of the
 * pending history). Lazy: fetched when a step's detail is opened.
 */
export function useWorkspacePendingEventsDiff(
  workspaceName: string | null,
  from: number | null,
  to: number | null,
) {
  return useQuery({
    queryKey: queryKeys.workspaces.pendingEventsDiff(
      workspaceName ?? '',
      from ?? 0,
      to ?? 0,
    ),
    queryFn: () =>
      apiFetch<{
        workspace: string
        contentStreamId: string
        from: number
        to: number
        events: WorkspacePendingDiffEvent[]
      }>(
        `/workspaces/${encodeURIComponent(workspaceName!)}/pending-events/diff?from=${from}&to=${to}`,
      ),
    enabled: workspaceName !== null && from !== null && to !== null,
    // The slice is immutable (events never change once recorded); only a
    // stream swap invalidates it, and that changes the key via `from`/`to`.
    staleTime: Infinity,
  })
}

export interface WorkspacePendingEvents {
  workspace: string
  baseWorkspace: string | null
  status: 'UP_TO_DATE' | 'OUTDATED'
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
 * The pending histories of several workspaces at once (the Workspaces graph
 * fetches one per visible branch). Returns a map keyed by workspace name;
 * entries are absent while loading or on error.
 */
export function useWorkspacesPendingEvents(
  workspaceNames: string[],
  enabled = true,
  refetchInterval?: number,
) {
  return useQueries({
    queries: workspaceNames.map((name) => ({
      queryKey: queryKeys.workspaces.pendingEvents(name),
      queryFn: () =>
        apiFetch<WorkspacePendingEvents>(
          `/workspaces/${encodeURIComponent(name)}/pending-events`,
        ),
      enabled,
      refetchInterval,
    })),
    combine: (results) => {
      const byWorkspace = new Map<string, WorkspacePendingEvents>()
      results.forEach((result, index) => {
        if (result.data) byWorkspace.set(workspaceNames[index], result.data)
      })
      return {
        byWorkspace,
        isLoading: results.some((result) => result.isLoading),
      }
    },
  })
}

export function useWorkspaceChanges(workspaceName: string | null) {
  return useQuery({
    queryKey: queryKeys.workspaces.changes(workspaceName ?? ''),
    queryFn: () =>
      apiFetch<{
        workspace: string
        baseWorkspace: string | null
        status: 'UP_TO_DATE' | 'OUTDATED'
        changes: WorkspaceChange[]
      }>(`/workspaces/${encodeURIComponent(workspaceName!)}/changes`),
    enabled: workspaceName !== null,
    // Dirty markers should feel current while editing elsewhere.
    staleTime: 10_000,
  })
}

/**
 * Workspace management (Api.Workspaces.Manage): creating shared/private
 * workspaces is open to every editor; editing, deleting and role assignments
 * additionally require the per-workspace manage permission - callers gate on
 * workspace.permissions.manage (the server re-checks).
 */

export interface CreateWorkspaceInput {
  title: string
  description?: string
  /** Defaults to "live" on the server. */
  baseWorkspaceName?: string
  /** "shared": every editor may collaborate; "private": only the creator. */
  visibility?: 'shared' | 'private'
}

export interface UpdateWorkspaceInput {
  title?: string
  description?: string
}

/** One role assignment: who (user or Flow role group) may do what. */
export interface WorkspaceRoleAssignment {
  subjectType: 'USER' | 'GROUP'
  subject: string
  /** Human-readable name for USER subjects; the role identifier for groups. */
  label: string
  role: 'VIEWER' | 'COLLABORATOR' | 'MANAGER'
}

export function createWorkspace(input: CreateWorkspaceInput) {
  return apiFetch<{ workspace: Workspace }>('/workspaces', {
    method: 'POST',
    body: input,
  })
}

export function updateWorkspace(
  workspaceName: string,
  input: UpdateWorkspaceInput,
) {
  return apiFetch<{ workspace: Workspace }>(
    `/workspaces/${encodeURIComponent(workspaceName)}`,
    { method: 'PATCH', body: input },
  )
}

/** With force, pending changes are discarded along with the workspace. */
export function deleteWorkspace(workspaceName: string, force = false) {
  return apiFetch<{ success: boolean }>(
    `/workspaces/${encodeURIComponent(workspaceName)}${force ? '?force=true' : ''}`,
    { method: 'DELETE' },
  )
}

/** Requires manage permission - only enable for such workspaces. */
export function useWorkspaceRoles(workspaceName: string | null) {
  return useQuery({
    queryKey: queryKeys.workspaces.roles(workspaceName ?? ''),
    queryFn: () =>
      apiFetch<{ assignments: WorkspaceRoleAssignment[] }>(
        `/workspaces/${encodeURIComponent(workspaceName!)}/roles`,
      ),
    enabled: workspaceName !== null,
  })
}

export function assignWorkspaceRole(
  workspaceName: string,
  assignment: Pick<WorkspaceRoleAssignment, 'subjectType' | 'subject' | 'role'>,
) {
  return apiFetch<{ assignments: WorkspaceRoleAssignment[] }>(
    `/workspaces/${encodeURIComponent(workspaceName)}/roles`,
    { method: 'POST', body: assignment },
  )
}

export function unassignWorkspaceRole(
  workspaceName: string,
  subject: Pick<WorkspaceRoleAssignment, 'subjectType' | 'subject'>,
) {
  // The assignment is addressed in the path - DELETE requests carry no body.
  return apiFetch<{ assignments: WorkspaceRoleAssignment[] }>(
    `/workspaces/${encodeURIComponent(workspaceName)}/roles/${encodeURIComponent(subject.subjectType)}/${encodeURIComponent(subject.subject)}`,
    { method: 'DELETE' },
  )
}
