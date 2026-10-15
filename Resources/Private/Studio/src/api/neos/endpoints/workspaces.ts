import { skipToken, useQuery } from '@tanstack/react-query'
import { queryClient } from '@/app/queryClient'
import { ApiError, problemOf } from '../../http/errors'
import { api, fetchAllPages, unwrap } from '../client'
import {
  activeContentRepositoryId,
  useActiveContentRepositoryId,
} from '../activeContentRepository'
import { neosKeys } from '../keys'
import type {
  BaseWorkspaceChange,
  Change,
  DiscardingResult,
  PaginatedEventListing,
  PublishingResult,
  Workspace,
  WorkspaceConflictProblem,
  WorkspaceCreate,
  WorkspaceDiscard,
  WorkspacePublish,
  WorkspaceRebase,
  WorkspaceRole,
  WorkspaceRoleAssign,
  WorkspaceRoleSubject,
  WorkspaceUpdate,
} from '../schema'
import type { operations } from '../schema/openapi'

/**
 * The workspaces of a content repository (Neos.Api's Workspaces tag). The
 * hooks read the selected site's content repository; the writes name theirs
 * explicitly - a write must not land in whichever repository happens to be
 * selected when it runs.
 */

const WORKSPACES = '/cr/{contentRepositoryId}/workspaces'
const WORKSPACE = '/cr/{contentRepositoryId}/workspaces/{workspaceName}'

/** The path parameters of a workspace operation. */
function workspacePath(contentRepositoryId: string, workspaceName: string) {
  return { contentRepositoryId, workspaceName }
}

/** All workspaces the account may read. Read-only - see ensurePersonalWorkspace. */
async function listWorkspaces(
  contentRepositoryId: string,
  signal?: AbortSignal,
): Promise<Workspace[]> {
  return (
    await unwrap(
      api.GET(WORKSPACES, {
        params: { path: { contentRepositoryId } },
        signal,
      }),
    )
  ).data
}

export function useWorkspaces(enabled = true, refetchInterval?: number) {
  const contentRepositoryId = useActiveContentRepositoryId()
  return useQuery({
    queryKey: neosKeys.workspaces.list(contentRepositoryId ?? ''),
    queryFn:
      enabled && contentRepositoryId !== null
        ? ({ signal }) => listWorkspaces(contentRepositoryId, signal)
        : skipToken,
    refetchInterval,
  })
}

// One provisioning per content repository and document load (see below).
const personalWorkspaceProvisioning = new Map<string, Promise<void>>()

/**
 * Provisions the acting user's personal workspace in the content repository
 * when it is missing (as the classic Neos UI does on backend load): editing
 * happens there by default, and the shell cannot initialise without one. The
 * App calls it at boot, for the selected site's content repository, before
 * it relies on the workspace list; the list is refreshed once the workspace
 * exists.
 *
 * Runs once per content repository - later calls share the first one's
 * outcome. Neos.Api creates the workspace for the caller with classification
 * "personal"; a 4xx (no Neos user behind the token, or created meanwhile - a
 * 409) is final and ignored, a transient failure (network, 5xx) lets a later
 * call try again. Never rejects.
 */
export function ensurePersonalWorkspace(
  contentRepositoryId: string,
): Promise<void> {
  let provisioning = personalWorkspaceProvisioning.get(contentRepositoryId)
  if (!provisioning) {
    provisioning = provisionPersonalWorkspace(contentRepositoryId).catch(
      (error: unknown) => {
        if (!(error instanceof ApiError && error.status < 500)) {
          personalWorkspaceProvisioning.delete(contentRepositoryId)
        }
      },
    )
    personalWorkspaceProvisioning.set(contentRepositoryId, provisioning)
  }
  return provisioning
}

async function provisionPersonalWorkspace(
  contentRepositoryId: string,
): Promise<void> {
  const workspaces = await queryClient.fetchQuery({
    queryKey: neosKeys.workspaces.list(contentRepositoryId),
    queryFn: ({ signal }) => listWorkspaces(contentRepositoryId, signal),
  })
  if (workspaces.some((workspace) => workspace.classification === 'personal')) {
    return
  }
  await unwrap(
    api.POST(WORKSPACES, {
      params: { path: { contentRepositoryId } },
      body: { classification: 'personal' } satisfies WorkspaceCreate,
    }),
  )
  await queryClient.invalidateQueries({
    queryKey: neosKeys.workspaces.list(contentRepositoryId),
  })
}

/**
 * Whether the account may publish the workspace: publishing writes to the
 * base workspace, so it takes write permission there (a base the account may
 * not read cannot be published to either).
 */
export function canPublish(workspace: Workspace, all: Workspace[]): boolean {
  const base = all.find(
    (candidate) => candidate.name === workspace.baseWorkspaceName,
  )
  return base?.permissions.write === true
}

/**
 * How many distinct nodes a change list touches. The changes resource returns
 * one entry per node variant - UIs that show no dimensions count nodes, or a
 * single move of a node existing in two languages would read as two changes.
 */
export function countChangedNodes(changes: Change[]): number {
  return new Set(changes.map((change) => change.nodeAggregateId)).size
}

/**
 * The pending changes of the workspace - all, or with filterBySite only the
 * ones in that site (its site node's aggregate id) - with the workspace
 * itself: read along because clients poll the changes anyway, so its status
 * ("outdated": the base has moved on) surfaces without another query.
 */
export function useWorkspaceChanges(
  workspaceName: string | null,
  options: { filterBySite?: string | null } = {},
) {
  const contentRepositoryId = useActiveContentRepositoryId()
  const filterBySite = options.filterBySite ?? null
  return useQuery({
    queryKey: neosKeys.workspaces.pendingChanges(
      contentRepositoryId ?? '',
      workspaceName ?? '',
      filterBySite,
    ),
    queryFn:
      workspaceName !== null && contentRepositoryId !== null
        ? async ({ signal }) => {
            const [workspace, changes] = await Promise.all([
              unwrap(
                api.GET(WORKSPACE, {
                  params: {
                    path: workspacePath(contentRepositoryId, workspaceName),
                  },
                  signal,
                }),
              ),
              fetchWorkspaceChanges(
                contentRepositoryId,
                workspaceName,
                { filterBySite: filterBySite ?? undefined },
                signal,
              ),
            ])
            return { workspace, changes }
          }
        : skipToken,
    // Dirty markers should feel current while editing elsewhere.
    staleTime: 10_000,
  })
}

/** Publishes the workspace's changes to its base - all, or of a site or documents. */
export function publishWorkspace(
  contentRepositoryId: string,
  workspaceName: string,
  scope: WorkspacePublish = {},
): Promise<PublishingResult> {
  return unwrap(
    api.POST('/cr/{contentRepositoryId}/workspaces/{workspaceName}/publish', {
      params: { path: workspacePath(contentRepositoryId, workspaceName) },
      body: scope,
    }),
  )
}

/** Discards the workspace's changes - all, or of a site or documents. */
export function discardWorkspace(
  contentRepositoryId: string,
  workspaceName: string,
  scope: WorkspaceDiscard = {},
): Promise<DiscardingResult> {
  return unwrap(
    api.POST('/cr/{contentRepositoryId}/workspaces/{workspaceName}/discard', {
      params: { path: workspacePath(contentRepositoryId, workspaceName) },
      body: scope,
    }),
  )
}

/**
 * Rebases the workspace onto the current state of its base - what the classic
 * UI calls "synchronize". A 409 conflict problem when own changes collide
 * with the incoming ones (see workspaceConflicts); "force" drops them.
 */
export async function rebaseWorkspace(
  contentRepositoryId: string,
  workspaceName: string,
  strategy: 'fail' | 'force' = 'fail',
): Promise<void> {
  await unwrap(
    api.POST('/cr/{contentRepositoryId}/workspaces/{workspaceName}/rebase', {
      params: { path: workspacePath(contentRepositoryId, workspaceName) },
      body: { strategy } satisfies WorkspaceRebase,
    }),
  )
}

/**
 * Retargets where the workspace publishes to. A 409 while it still has
 * publishable changes (see isConflict).
 */
export async function changeBaseWorkspace(
  contentRepositoryId: string,
  workspaceName: string,
  baseWorkspaceName: string,
): Promise<void> {
  await unwrap(
    api.PUT(
      '/cr/{contentRepositoryId}/workspaces/{workspaceName}/baseworkspace',
      {
        params: { path: workspacePath(contentRepositoryId, workspaceName) },
        body: { baseWorkspaceName } satisfies BaseWorkspaceChange,
      },
    ),
  )
}

/**
 * The conflict problem of a failed rebase or publish (a 409 titled "rebase":
 * own changes collide with the base, forcing drops them; "partial": a
 * selection can't be published apart from the rest), null for any other
 * error - callers fall back to a generic message then.
 */
export function workspaceConflicts(
  error: unknown,
): WorkspaceConflictProblem | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null
  const problem = problemOf(error)
  if (problem?.title !== 'rebase' && problem?.title !== 'partial') return null
  return {
    ...(problem as WorkspaceConflictProblem),
    conflicts: Array.isArray(problem.conflicts)
      ? (problem.conflicts as WorkspaceConflictProblem['conflicts'])
      : [],
  }
}

export function createWorkspace(
  contentRepositoryId: string,
  input: WorkspaceCreate,
): Promise<Workspace> {
  return unwrap(
    api.POST(WORKSPACES, {
      params: { path: { contentRepositoryId } },
      body: input,
    }),
  )
}

export function updateWorkspace(
  contentRepositoryId: string,
  workspaceName: string,
  input: WorkspaceUpdate,
): Promise<Workspace> {
  return unwrap(
    api.PATCH(WORKSPACE, {
      params: { path: workspacePath(contentRepositoryId, workspaceName) },
      body: input,
    }),
  )
}

/** With force, pending changes are discarded along with the workspace. */
export async function deleteWorkspace(
  contentRepositoryId: string,
  workspaceName: string,
  force = false,
): Promise<void> {
  await unwrap(
    api.DELETE(WORKSPACE, {
      params: {
        path: workspacePath(contentRepositoryId, workspaceName),
        query: force ? { force: true } : {},
      },
    }),
  )
}

const ROLE =
  '/cr/{contentRepositoryId}/workspaces/{workspaceName}/roles/{subjectType}/{subjectId}'

function rolePath(
  contentRepositoryId: string,
  workspaceName: string,
  subject: WorkspaceRoleSubject,
) {
  return {
    ...workspacePath(contentRepositoryId, workspaceName),
    subjectType: subject.type,
    subjectId: subject.id,
  }
}

/** Who (a user or a Flow role group) may do what. Requires manage permission. */
export function useWorkspaceRoles(workspaceName: string | null) {
  const contentRepositoryId = useActiveContentRepositoryId()
  return useQuery({
    queryKey: neosKeys.workspaces.roles(
      contentRepositoryId ?? '',
      workspaceName ?? '',
    ),
    queryFn:
      workspaceName !== null && contentRepositoryId !== null
        ? async ({ signal }) =>
            (
              await unwrap(
                api.GET(
                  '/cr/{contentRepositoryId}/workspaces/{workspaceName}/roles',
                  {
                    params: {
                      path: workspacePath(contentRepositoryId, workspaceName),
                    },
                    signal,
                  },
                ),
              )
            ).data
        : skipToken,
  })
}

/** Gives the subject the role; a role it had is replaced. */
export async function assignWorkspaceRole(
  contentRepositoryId: string,
  workspaceName: string,
  subject: WorkspaceRoleSubject,
  role: WorkspaceRole,
): Promise<void> {
  await unwrap(
    api.PUT(ROLE, {
      params: { path: rolePath(contentRepositoryId, workspaceName, subject) },
      body: { role } satisfies WorkspaceRoleAssign,
    }),
  )
}

export async function unassignWorkspaceRole(
  contentRepositoryId: string,
  workspaceName: string,
  subject: WorkspaceRoleSubject,
): Promise<void> {
  await unwrap(
    api.DELETE(ROLE, {
      params: { path: rolePath(contentRepositoryId, workspaceName, subject) },
    }),
  )
}

/** The query parameters of listWorkspaceEvents (Neos.Api's). */
type WorkspaceEventsQuery = NonNullable<
  operations['listWorkspaceEvents']['parameters']['query']
>

/**
 * A page of the events of the workspace's current content stream: after a
 * sequence number (a 409 if it is of an earlier content stream - the
 * workspace was published, discarded or rebased since), or sorted, with what
 * each changed (include=diff) and its node and document (node, document).
 * The filters (by event type, node, document, tag) combine; a filtered page
 * is filled with matching events.
 */
export function listWorkspaceEvents(
  workspaceName: string,
  params: WorkspaceEventsQuery,
  contentRepositoryId: string = activeContentRepositoryId(),
  signal?: AbortSignal,
): Promise<PaginatedEventListing> {
  return unwrap(
    api.GET('/cr/{contentRepositoryId}/workspaces/{workspaceName}/events', {
      params: {
        path: workspacePath(contentRepositoryId, workspaceName),
        query: params,
      },
      signal,
    }),
  )
}

/**
 * All changes of the workspace with the filters and include given (see
 * Neos.Api's listWorkspaceChanges), every page.
 */
export function fetchWorkspaceChanges(
  contentRepositoryId: string,
  workspaceName: string,
  params: {
    filterByDocument?: string
    /** A site node's aggregate id: only the changes in that site. */
    filterBySite?: string
    filterByChangeType?: string
    filterByNodeType?: string
    include?: string
  },
  signal?: AbortSignal,
): Promise<Change[]> {
  return fetchAllPages((page) =>
    unwrap(
      api.GET('/cr/{contentRepositoryId}/workspaces/{workspaceName}/changes', {
        params: {
          path: workspacePath(contentRepositoryId, workspaceName),
          query: { ...params, ...page },
        },
        signal,
      }),
    ),
  )
}

// --- Scoped invalidation: what a write affects, and nothing more ---

/**
 * Refetch the workspace's pending changes - every read under them: the
 * dirty markers' list, the review, document diffs, the trash, conflicts.
 */
export function invalidateWorkspaceChanges(
  contentRepositoryId: string,
  workspaceName: string,
): Promise<void> {
  return queryClient.invalidateQueries({
    queryKey: neosKeys.workspaces.changes(contentRepositoryId, workspaceName),
  })
}

/** Refetch the workspace's event history (the pending history and its diffs). */
export function invalidateWorkspaceHistory(
  contentRepositoryId: string,
  workspaceName: string,
): Promise<void> {
  return queryClient.invalidateQueries({
    queryKey: neosKeys.workspaces.history(contentRepositoryId, workspaceName),
  })
}

/**
 * Refetch everything read of the workspace - changes, history, roles - and
 * the workspace list, which carries its status and permissions.
 */
export async function invalidateWorkspace(
  contentRepositoryId: string,
  workspaceName: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: neosKeys.workspaces.workspace(
        contentRepositoryId,
        workspaceName,
      ),
    }),
    queryClient.invalidateQueries({
      queryKey: neosKeys.workspaces.list(contentRepositoryId),
    }),
  ])
}
