import { useMemo } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { queryClient } from '@/app/queryClient'
import {
  apiFetch,
  ApiError,
  fetchAllPages,
  problemOf,
  queryString,
  studioFetch,
  type Listing,
} from './client'
import { queryKeys } from './keys'
import { contentRepositoryPath } from './nodeAddress'
import { fetchUserLabels } from './users'
import { TASK_EXTENSION_KEY, type Task } from './tasks'

/**
 * Workspaces come from Neos.Api (`/cr/{cr}/workspaces`); the review, history
 * and trash read models from the Studio's own endpoints
 * (`/neos/studio/api/workspaces/{name}/...`). Neos.Api's workspace shape is
 * adapted ONCE, here (toWorkspace), into the shell's internal Workspace type
 * below - uppercase enums, `baseWorkspace`/`owner`, a derived `publish`
 * permission and the Studio's extensions - so every consumer stays unaware of
 * the wire format.
 */

export interface Workspace {
  name: string
  baseWorkspace: string | null
  title: string
  description: string
  /** ROOT, PERSONAL, SHARED or UNKNOWN. */
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
  /**
   * Namespaced contributions of the Studio (and its plugins) - e.g. the task
   * workflow's metadata under 'Medienreaktor.NeosStudio:task'. Absence of a
   * key means "not applicable". Consumed by workspace decorators (see
   * features/workspaces/decorators.ts), which know their own key's shape;
   * the shell treats it as opaque.
   */
  extensions: Record<string, unknown>
}

/** Neos.Api's Workspace. */
interface ApiWorkspace {
  name: string
  baseWorkspaceName: string | null
  title: string
  description: string
  classification: 'root' | 'personal' | 'shared' | 'unknown'
  ownerId: string | null
  status: 'up_to_date' | 'outdated'
  hasPublishableChanges: boolean
  permissions: { read: boolean; write: boolean; manage: boolean }
}

function workspacesPath(workspaceName?: string): string {
  const base = `${contentRepositoryPath()}/workspaces`
  return workspaceName === undefined
    ? base
    : `${base}/${encodeURIComponent(workspaceName)}`
}

function studioWorkspacePath(workspaceName: string): string {
  return `/workspaces/${encodeURIComponent(workspaceName)}`
}

/**
 * Neos.Api workspace -> the shell's Workspace. `publish` needs the base's
 * write permission, looked up in `all` (a base the account may not read
 * cannot be published to either); `extensions` come from the task list.
 */
function toWorkspace(
  workspace: ApiWorkspace,
  all: ApiWorkspace[],
  extensions: Record<string, unknown> = {},
): Workspace {
  const base =
    workspace.baseWorkspaceName === null
      ? null
      : (all.find(
          (candidate) => candidate.name === workspace.baseWorkspaceName,
        ) ?? null)
  return {
    name: workspace.name,
    baseWorkspace: workspace.baseWorkspaceName,
    title: workspace.title,
    description: workspace.description,
    classification: workspace.classification.toUpperCase(),
    owner: workspace.ownerId,
    hasPublishableChanges: workspace.hasPublishableChanges,
    status: workspace.status === 'outdated' ? 'OUTDATED' : 'UP_TO_DATE',
    permissions: {
      read: workspace.permissions.read,
      write: workspace.permissions.write,
      manage: workspace.permissions.manage,
      publish: base !== null && base.permissions.write,
    },
    extensions,
  }
}

/** The Studio's per-workspace extensions, from the task list. */
function extensionsFromTasks(
  tasks: Task[] | null,
): Map<string, Record<string, unknown>> {
  const byWorkspace = new Map<string, Record<string, unknown>>()
  for (const task of tasks ?? []) {
    // The task's own workspace JSON (Studio-serialized) already carries the
    // complete extension incl. assigneeLabel; rebuild it only as a fallback.
    const extension =
      task.workspace?.extensions?.[TASK_EXTENSION_KEY] ??
      ({
        status: task.status,
        assignee: task.assignee,
        assigneeLabel: null,
        createdBy: task.createdBy,
        createdAt: task.createdAt,
      } satisfies Record<string, unknown>)
    byWorkspace.set(task.workspaceName, {
      ...(task.workspace?.extensions ?? {}),
      [TASK_EXTENSION_KEY]: extension,
    })
  }
  return byWorkspace
}

/** The task list for the extensions join; a failure only drops the badges. */
async function fetchTasksForExtensions(): Promise<Task[] | null> {
  try {
    const response = await queryClient.fetchQuery({
      queryKey: queryKeys.tasks,
      queryFn: () => studioFetch<{ tasks: Task[] }>('/tasks'),
      staleTime: 5_000,
    })
    return response.tasks
  } catch {
    return null
  }
}

async function fetchApiWorkspaces(): Promise<ApiWorkspace[]> {
  return (await apiFetch<Listing<ApiWorkspace>>(workspacesPath())).data
}

/**
 * All workspaces the account may read, as the shell's Workspace type.
 *
 * Provisions the acting user's personal workspace when it is missing (as the
 * classic Neos UI does on backend load): editing happens there by default,
 * and the shell cannot initialise without one. Neos.Api creates it for the
 * caller with classification "personal"; idempotent enough - a second one is
 * a 409, ignored like any other failure here.
 */
async function fetchWorkspaces(): Promise<{ workspaces: Workspace[] }> {
  const [initial, tasks] = await Promise.all([
    fetchApiWorkspaces(),
    fetchTasksForExtensions(),
  ])
  let workspaces = initial
  if (
    !workspaces.some((workspace) => workspace.classification === 'personal')
  ) {
    try {
      await apiFetch(workspacesPath(), {
        method: 'POST',
        body: { classification: 'personal' },
      })
      workspaces = await fetchApiWorkspaces()
    } catch {
      /* no Neos user behind the token, or created meanwhile */
    }
  }
  const extensions = extensionsFromTasks(tasks)
  return {
    workspaces: workspaces.map((workspace) =>
      toWorkspace(workspace, workspaces, extensions.get(workspace.name)),
    ),
  }
}

export function useWorkspaces(enabled = true, refetchInterval?: number) {
  return useQuery({
    queryKey: queryKeys.workspaces.all,
    queryFn: fetchWorkspaces,
    enabled,
    refetchInterval,
  })
}

export interface WorkspaceChange {
  nodeAggregateId: string
  /** Closest containing document (the node itself if it is a document). */
  documentAggregateId: string | null
  /** Closest containing site, for scoping counts/publish to one site. */
  siteAggregateId: string | null
  originDimensionSpacePoint: Record<string, string> | null
  created: boolean
  changed: boolean
  moved: boolean
  deleted: boolean
}

/** Neos.Api's Change (the dimension space point is a JSON string there). */
interface ApiChange {
  nodeAggregateId: string
  documentAggregateId: string | null
  siteAggregateId: string | null
  originDimensionSpacePoint: string | null
  created: boolean
  changed: boolean
  moved: boolean
  deleted: boolean
}

/**
 * How many distinct nodes a change list touches. The changes resource returns
 * one entry per node variant - UIs that show no dimensions count nodes, or a
 * single move of a node existing in two languages would read as two changes.
 */
export function countChangedNodes(changes: WorkspaceChange[]): number {
  return new Set(changes.map((change) => change.nodeAggregateId)).size
}

/**
 * Scopes a publish/discard; empty = whole workspace. `site` / `document` scope
 * to one aggregate; `documents` scopes to a selection of documents (the review
 * dialog) - published/discarded one by one on the server. When several are set,
 * `documents` wins, then `site`, then `document`.
 */
export interface WorkspaceOperationFilter {
  site?: string
  document?: string
  documents?: string[]
}

/** Neos.Api's publish/discard body: a site OR documents, never both, never an
 * empty document list. */
function operationBody(filter?: WorkspaceOperationFilter): {
  siteAggregateId?: string
  documentAggregateIds?: string[]
} {
  if (filter?.documents !== undefined && filter.documents.length > 0) {
    return { documentAggregateIds: filter.documents }
  }
  if (filter?.site) return { siteAggregateId: filter.site }
  if (filter?.document) return { documentAggregateIds: [filter.document] }
  return {}
}

/** Publish pending changes of the workspace to its base workspace. */
export async function publishWorkspace(
  workspaceName: string,
  filter?: WorkspaceOperationFilter,
): Promise<{ workspace: string; publishedChanges: number }> {
  const result = await apiFetch<{ numberOfPublishedChanges: number }>(
    `${workspacesPath(workspaceName)}/publish`,
    { method: 'POST', body: operationBody(filter) },
  )
  return {
    workspace: workspaceName,
    publishedChanges: result.numberOfPublishedChanges,
  }
}

/**
 * Rebase the workspace onto the current state of its base workspace - what
 * the classic UI calls "synchronize": changes published by others flow in
 * underneath the workspace's own pending changes. Rejected with a 409 conflict
 * problem when own changes collide with the incoming ones (see
 * getRebaseConflicts); retrying with force drops the conflicting own changes.
 */
export async function rebaseWorkspace(
  workspaceName: string,
  strategy?: 'force',
): Promise<{ workspace: string; rebased: boolean }> {
  await apiFetch(`${workspacesPath(workspaceName)}/rebase`, {
    method: 'POST',
    body: { strategy: strategy ?? 'fail' },
  })
  return { workspace: workspaceName, rebased: true }
}

/** Discard pending changes of the workspace. */
export async function discardWorkspace(
  workspaceName: string,
  filter?: WorkspaceOperationFilter,
): Promise<{ workspace: string; discardedChanges: number }> {
  const result = await apiFetch<{ numberOfDiscardedChanges: number }>(
    `${workspacesPath(workspaceName)}/discard`,
    { method: 'POST', body: operationBody(filter) },
  )
  return {
    workspace: workspaceName,
    discardedChanges: result.numberOfDiscardedChanges,
  }
}

/**
 * Rebase the workspace onto a different base workspace - what "switching the
 * workspace" means in Neos: editing always happens in the personal workspace,
 * this only retargets where its changes get published. Rejected with a 409
 * while the workspace still has publishable changes (see
 * isWorkspaceNotEmptyError).
 */
export async function changeBaseWorkspace(
  workspaceName: string,
  baseWorkspace: string,
): Promise<{ workspace: string; baseWorkspace: string }> {
  await apiFetch(`${workspacesPath(workspaceName)}/baseworkspace`, {
    method: 'PUT',
    body: { baseWorkspaceName: baseWorkspace },
  })
  return { workspace: workspaceName, baseWorkspace }
}

/**
 * Whether a changeBaseWorkspace failure is the "publish or discard first"
 * case: Neos.Api answers it - and only it - with a 409.
 */
export function isWorkspaceNotEmptyError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409
}

/** One conflicting change surfaced by a failed rebase/publish. Labels and
 * the document address are resolved separately (useConflictDetails) and may
 * stay null. */
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

/** Neos.Api's ConflictingChange. */
interface ApiConflictingChange {
  nodeAggregateId: string | null
  documentAggregateId: string | null
  siteAggregateId: string | null
  reason: string | null
  message: string
  typeOfChange?: string | null
}

function normalizeTypeOfChange(
  value: string | null | undefined,
): RebaseConflict['typeOfChange'] {
  const kind = (value ?? '').replace(/^node_has_been_/, '')
  return kind === 'created' ||
    kind === 'changed' ||
    kind === 'moved' ||
    kind === 'deleted'
    ? kind
    : null
}

/**
 * Extract the structured conflicts from a 409 conflict problem (title
 * "rebase" or "partial"), or null if the error is not a workspace conflict
 * (so callers fall back to a generic error toast - e.g. the "removed" problem
 * of a selected document deleted meanwhile, whose detail says what happened).
 */
export function getRebaseConflicts(error: unknown): RebaseConflicts | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null
  const problem = problemOf(error)
  if (problem === null) return null
  const code =
    problem.title === 'rebase'
      ? 'rebase_conflicts'
      : problem.title === 'partial'
        ? 'partial_publish_conflicts'
        : null
  if (code === null) return null
  const conflicts = Array.isArray(problem.conflicts)
    ? (problem.conflicts as ApiConflictingChange[])
    : []
  return {
    code,
    conflicts: conflicts.map((conflict) => ({
      nodeAggregateId: conflict.nodeAggregateId,
      nodeLabel: null,
      documentAggregateId: conflict.documentAggregateId,
      documentLabel: null,
      documentAddress: null,
      siteAggregateId: conflict.siteAggregateId,
      typeOfChange: normalizeTypeOfChange(conflict.typeOfChange),
      reason:
        conflict.reason === 'node_has_been_deleted' ? conflict.reason : null,
      message: conflict.message,
    })),
  }
}

interface ConflictNodeDetail {
  nodeAggregateId: string
  nodeLabel: string | null
  documentAggregateId: string | null
  documentLabel: string | null
  documentAddress: string | null
}

/**
 * The conflicts with their labels and document addresses filled in - Neos.Api
 * names conflicting nodes by id only; the Studio resolves them in the
 * workspace (deleted nodes included, falling back to the base). Until that
 * answer arrives (or when it fails) the conflicts come back as given.
 */
export function useConflictDetails(
  workspaceName: string | null,
  conflicts: RebaseConflict[],
): RebaseConflict[] {
  const ids = [
    ...new Set(
      conflicts
        .map((conflict) => conflict.nodeAggregateId)
        .filter((id): id is string => id !== null),
    ),
  ].sort()
  const { data } = useQuery({
    queryKey: [
      'workspaces',
      workspaceName ?? '',
      'conflict-details',
      ids.join(','),
    ],
    queryFn: () =>
      studioFetch<{ nodes: ConflictNodeDetail[] }>(
        `${studioWorkspacePath(workspaceName!)}/conflict-details${queryString({ nodeAggregateIds: ids.join(',') })}`,
      ),
    enabled: workspaceName !== null && ids.length > 0,
    staleTime: Infinity,
  })
  return useMemo(() => {
    if (!data) return conflicts
    const byId = new Map(data.nodes.map((node) => [node.nodeAggregateId, node]))
    return conflicts.map((conflict) => {
      const detail =
        conflict.nodeAggregateId !== null
          ? byId.get(conflict.nodeAggregateId)
          : undefined
      if (!detail) return conflict
      return {
        ...conflict,
        nodeLabel: conflict.nodeLabel ?? detail.nodeLabel,
        documentAggregateId:
          conflict.documentAggregateId ?? detail.documentAggregateId,
        documentLabel: conflict.documentLabel ?? detail.documentLabel,
        documentAddress: conflict.documentAddress ?? detail.documentAddress,
      }
    })
  }, [conflicts, data])
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
      studioFetch<{
        workspace: string
        baseWorkspace: string | null
        status: 'UP_TO_DATE' | 'OUTDATED'
        documents: WorkspaceDocumentChange[]
      }>(`${studioWorkspacePath(workspaceName!)}/document-changes`),
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
  /** Who made the edit; the stable key an avatar takes its color from. */
  initiatingUserId: string | null
  initiatingUserLabel: string | null
  recordedAt: string
  /** The distinct documents the step touched (label of the first event wins). */
  documents: { id: string; label: string | null; address: string | null }[]
}

/**
 * Property-set commands squash across executions: inline typing persists a
 * SetNodeProperties every 1.5-5s, and a paragraph of writing must read as
 * ONE step in the history, not thirty. Consecutive saves by the same user
 * on the same node squash while their initiating timestamps stay within
 * this sliding window ("one editing session on this element"). Only
 * CONSECUTIVE events squash, so anything interleaving (another user,
 * another element) cuts the step - the from..to sequence range stays exact
 * for the diff resource.
 */
const SQUASH_COMMANDS = new Set([
  'SetNodeProperties',
  'SetSerializedNodeProperties',
])
const SQUASH_WINDOW_MS = 30_000
/** Hard cap per squashed step - the pending-events diff resource rejects
 * sequence ranges of 200+, and a step must stay diffable. */
const SQUASH_MAX_EVENTS = 100

function withinSquashWindow(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false
  const first = Date.parse(a)
  const second = Date.parse(b)
  if (Number.isNaN(first) || Number.isNaN(second)) return false
  return Math.abs(second - first) <= SQUASH_WINDOW_MS
}

/**
 * Group a pending history (oldest first) into editing steps. Events of one
 * command commit contiguously, so grouping consecutive runs is exact; the
 * guard on command/timestamp presence keeps unknown events as single steps.
 * Rapid-fire property saves additionally squash across commands (see
 * SQUASH_COMMANDS above).
 */
export function groupPendingEvents(
  events: WorkspacePendingEvent[],
): WorkspacePendingStep[] {
  const steps: WorkspacePendingStep[] = []
  let current: WorkspacePendingStep | null = null
  for (const event of events) {
    const lastEvent = current?.events[current.events.length - 1] ?? null
    const joins =
      current !== null &&
      current.command !== null &&
      event.command === current.command &&
      ((event.initiatingTimestamp !== null &&
        event.initiatingTimestamp === current.events[0].initiatingTimestamp) ||
        // The typing-save squash: same user, same node, close enough in time.
        (SQUASH_COMMANDS.has(current.command) &&
          lastEvent !== null &&
          current.events.length < SQUASH_MAX_EVENTS &&
          event.nodeAggregateId !== null &&
          event.nodeAggregateId === lastEvent.nodeAggregateId &&
          withinSquashWindow(
            lastEvent.initiatingTimestamp,
            event.initiatingTimestamp,
          ))) &&
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
        initiatingUserId: event.initiatingUserId,
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
      studioFetch<{
        workspace: string
        baseWorkspace: string | null
        documentAggregateId: string
        nodes: WorkspaceDocumentDiffNode[]
      }>(
        `${studioWorkspacePath(workspaceName!)}/document-diff${queryString({ documentAggregateId })}`,
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
      studioFetch<{
        workspace: string
        contentStreamId: string
        from: number
        to: number
        events: WorkspacePendingDiffEvent[]
      }>(
        `${studioWorkspacePath(workspaceName!)}/pending-events/diff${queryString({ from, to })}`,
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
        studioFetch<WorkspacePendingEvents>(
          `${studioWorkspacePath(name)}/pending-events`,
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

export interface WorkspaceChanges {
  workspace: string
  baseWorkspace: string | null
  /**
   * UP_TO_DATE or OUTDATED - fetched along with the changes because clients
   * poll them anyway, so "base has moved on" surfaces without another hook.
   */
  status: 'UP_TO_DATE' | 'OUTDATED'
  changes: WorkspaceChange[]
}

async function fetchWorkspaceChanges(
  workspaceName: string,
): Promise<WorkspaceChanges> {
  const [workspace, changes] = await Promise.all([
    apiFetch<ApiWorkspace>(workspacesPath(workspaceName)),
    fetchAllPages<ApiChange>(`${workspacesPath(workspaceName)}/changes`),
  ])
  return {
    workspace: workspace.name,
    baseWorkspace: workspace.baseWorkspaceName,
    status: workspace.status === 'outdated' ? 'OUTDATED' : 'UP_TO_DATE',
    changes: changes.map((change) => ({
      nodeAggregateId: change.nodeAggregateId,
      documentAggregateId: change.documentAggregateId,
      siteAggregateId: change.siteAggregateId,
      originDimensionSpacePoint:
        change.originDimensionSpacePoint === null
          ? null
          : (JSON.parse(change.originDimensionSpacePoint) as Record<
              string,
              string
            >),
      created: change.created,
      changed: change.changed,
      moved: change.moved,
      deleted: change.deleted,
    })),
  }
}

export function useWorkspaceChanges(workspaceName: string | null) {
  return useQuery({
    queryKey: queryKeys.workspaces.changes(workspaceName ?? ''),
    queryFn: () => fetchWorkspaceChanges(workspaceName!),
    enabled: workspaceName !== null,
    // Dirty markers should feel current while editing elsewhere.
    staleTime: 10_000,
  })
}

/**
 * Workspace management: creating shared/private workspaces is open to every
 * editor; editing, deleting and role assignments
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

/** A shared workspace ("public" in Neos.Api's terms when visibility is shared). */
export async function createWorkspace(
  input: CreateWorkspaceInput,
): Promise<{ workspace: Workspace }> {
  const created = await apiFetch<ApiWorkspace>(workspacesPath(), {
    method: 'POST',
    body: {
      classification: 'shared',
      title: input.title,
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      ...(input.baseWorkspaceName !== undefined
        ? { baseWorkspaceName: input.baseWorkspaceName }
        : {}),
      visibility: input.visibility === 'private' ? 'private' : 'public',
    },
  })
  return { workspace: await withPublishPermission(created) }
}

export async function updateWorkspace(
  workspaceName: string,
  input: UpdateWorkspaceInput,
): Promise<{ workspace: Workspace }> {
  const updated = await apiFetch<ApiWorkspace>(workspacesPath(workspaceName), {
    method: 'PATCH',
    body: input,
  })
  return { workspace: await withPublishPermission(updated) }
}

/** A single Neos.Api workspace in the shell's shape (its base looked up for
 * permissions.publish). */
async function withPublishPermission(
  workspace: ApiWorkspace,
): Promise<Workspace> {
  if (workspace.baseWorkspaceName === null) return toWorkspace(workspace, [])
  try {
    return toWorkspace(workspace, [
      await apiFetch<ApiWorkspace>(workspacesPath(workspace.baseWorkspaceName)),
    ])
  } catch {
    return toWorkspace(workspace, [])
  }
}

/** With force, pending changes are discarded along with the workspace. */
export async function deleteWorkspace(
  workspaceName: string,
  force = false,
): Promise<{ success: boolean }> {
  await apiFetch(
    `${workspacesPath(workspaceName)}${force ? queryString({ force: true }) : ''}`,
    { method: 'DELETE' },
  )
  return { success: true }
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
  nodeAddress: string | null
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
  /** Restoring requires UP_TO_DATE - an outdated workspace must synchronize first. */
  status: 'UP_TO_DATE' | 'OUTDATED'
  items: WorkspaceTrashItem[]
  /** true when more is deleted than the resource lists at once. */
  truncated: boolean
}

/**
 * The workspace's deleted PAGES. Deleted content elements are left to the
 * resource: they are restored where they are edited, so listing them in a page
 * trash only invites a restore the panel cannot sensibly offer - and they would
 * take up room in a capped list that belongs to the pages.
 */
export function useWorkspaceTrash(workspaceName: string | null) {
  return useQuery({
    queryKey: queryKeys.workspaces.trash(workspaceName ?? ''),
    queryFn: () =>
      studioFetch<WorkspaceTrashResponse>(
        `${studioWorkspacePath(workspaceName!)}/trash${queryString({ documentsOnly: 1 })}`,
      ),
    enabled: workspaceName !== null,
  })
}

/**
 * Restore a deleted node (Neos.Api restoreNode), together with any deleted
 * ancestor it lives inside. Rejected with a 409 while the workspace is
 * outdated or when the node is not deleted itself - the problem's detail says
 * which. What was restored along with it is taken from the trash listing the
 * restore was offered from (Neos.Api answers 204).
 */
export async function restoreFromTrash(
  workspaceName: string,
  nodeAggregateId: string,
): Promise<{
  workspace: string
  restored: { nodeAggregateId: string; label: string | null }[]
}> {
  const item = queryClient
    .getQueryData<WorkspaceTrashResponse>(
      queryKeys.workspaces.trash(workspaceName),
    )
    ?.items.find((candidate) => candidate.nodeAggregateId === nodeAggregateId)
  await apiFetch(
    `${contentRepositoryPath()}/nodes/${encodeURIComponent(nodeAggregateId)}/restore${queryString({ workspaceName })}`,
    { method: 'POST' },
  )
  return {
    workspace: workspaceName,
    restored: [
      { nodeAggregateId, label: item?.label ?? null },
      ...(item?.restoresAncestors ?? []),
    ],
  }
}

/** Neos.Api's role assignment. */
interface ApiWorkspaceRoleAssignment {
  subject: { type: 'user' | 'group'; id: string }
  role: 'viewer' | 'collaborator' | 'manager'
}

function rolesPath(
  workspaceName: string,
  subject: Pick<WorkspaceRoleAssignment, 'subjectType' | 'subject'>,
): string {
  return `${workspacesPath(workspaceName)}/roles/${subject.subjectType.toLowerCase()}/${encodeURIComponent(subject.subject)}`
}

/**
 * The role assignments, user subjects labelled from the user list (readable
 * by every editor in the Studio).
 */
async function fetchWorkspaceRoles(
  workspaceName: string,
): Promise<{ assignments: WorkspaceRoleAssignment[] }> {
  const [listing, labels] = await Promise.all([
    apiFetch<Listing<ApiWorkspaceRoleAssignment>>(
      `${workspacesPath(workspaceName)}/roles`,
    ),
    fetchUserLabels().catch(() => new Map<string, string>()),
  ])
  return {
    assignments: listing.data.map((assignment) => ({
      subjectType: assignment.subject.type === 'user' ? 'USER' : 'GROUP',
      subject: assignment.subject.id,
      label:
        assignment.subject.type === 'user'
          ? (labels.get(assignment.subject.id) ?? assignment.subject.id)
          : assignment.subject.id,
      role: assignment.role.toUpperCase() as WorkspaceRoleAssignment['role'],
    })),
  }
}

/** Requires manage permission - only enable for such workspaces. */
export function useWorkspaceRoles(workspaceName: string | null) {
  return useQuery({
    queryKey: queryKeys.workspaces.roles(workspaceName ?? ''),
    queryFn: () => fetchWorkspaceRoles(workspaceName!),
    enabled: workspaceName !== null,
  })
}

/** Gives the subject the role; a role it had is replaced. */
export async function assignWorkspaceRole(
  workspaceName: string,
  assignment: Pick<WorkspaceRoleAssignment, 'subjectType' | 'subject' | 'role'>,
): Promise<void> {
  await apiFetch(rolesPath(workspaceName, assignment), {
    method: 'PUT',
    body: { role: assignment.role.toLowerCase() },
  })
}

export async function unassignWorkspaceRole(
  workspaceName: string,
  subject: Pick<WorkspaceRoleAssignment, 'subjectType' | 'subject'>,
): Promise<void> {
  // The assignment is addressed in the path - DELETE requests carry no body.
  await apiFetch(rolesPath(workspaceName, subject), { method: 'DELETE' })
}
