import { useQuery } from '@tanstack/react-query'
import { ApiError, problemOf } from '../../http/errors'
import { queryString } from '../../http/request'
import {
  apiFetch,
  contentRepositoryPath,
  fetchAllPages,
  type Listing,
} from '../client'
import {
  activeContentRepositoryId,
  useActiveContentRepositoryId,
} from '../activeContentRepository'
import { neosKeys } from '../keys'
import type {
  Change,
  DiscardingResult,
  PaginatedEventListing,
  PublishingResult,
  Workspace,
  WorkspaceConflictProblem,
  WorkspaceCreate,
  WorkspaceDiscard,
  WorkspacePublish,
  WorkspaceRole,
  WorkspaceRoleAssignment,
  WorkspaceRoleSubject,
  WorkspaceUpdate,
} from '../schema'

/**
 * The workspaces of the selected site's content repository (Neos.Api's
 * Workspaces tag).
 */

function workspacesPath(
  workspaceName?: string,
  contentRepositoryId: string = activeContentRepositoryId(),
): string {
  const base = `${contentRepositoryPath(contentRepositoryId)}/workspaces`
  return workspaceName === undefined
    ? base
    : `${base}/${encodeURIComponent(workspaceName)}`
}

async function listWorkspaces(
  contentRepositoryId: string,
): Promise<Workspace[]> {
  return (
    await apiFetch<Listing<Workspace>>(
      workspacesPath(undefined, contentRepositoryId),
    )
  ).data
}

/**
 * All workspaces the account may read.
 *
 * Provisions the acting user's personal workspace when it is missing (as the
 * classic Neos UI does on backend load): editing happens there by default,
 * and the shell cannot initialise without one. Neos.Api creates it for the
 * caller with classification "personal"; a second one would be a 409,
 * ignored like any other failure here.
 */
async function fetchWorkspaces(
  contentRepositoryId: string,
): Promise<Workspace[]> {
  const workspaces = await listWorkspaces(contentRepositoryId)
  if (workspaces.some((workspace) => workspace.classification === 'personal')) {
    return workspaces
  }
  try {
    await apiFetch(workspacesPath(undefined, contentRepositoryId), {
      method: 'POST',
      body: { classification: 'personal' } satisfies WorkspaceCreate,
    })
    return await listWorkspaces(contentRepositoryId)
  } catch {
    // no Neos user behind the token, or created meanwhile
    return workspaces
  }
}

export function useWorkspaces(enabled = true, refetchInterval?: number) {
  const contentRepositoryId = useActiveContentRepositoryId()
  return useQuery({
    queryKey: neosKeys.workspaces.list(contentRepositoryId ?? ''),
    queryFn: () => fetchWorkspaces(contentRepositoryId!),
    enabled: enabled && contentRepositoryId !== null,
    refetchInterval,
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
 * The pending changes of the workspace, with the workspace itself - read
 * along because clients poll the changes anyway, so its status ("outdated":
 * the base has moved on) surfaces without another query.
 */
export function useWorkspaceChanges(workspaceName: string | null) {
  const contentRepositoryId = useActiveContentRepositoryId()
  return useQuery({
    queryKey: neosKeys.workspaces.changes(
      contentRepositoryId ?? '',
      workspaceName ?? '',
    ),
    queryFn: async () => {
      const path = workspacesPath(workspaceName!, contentRepositoryId!)
      const [workspace, changes] = await Promise.all([
        apiFetch<Workspace>(path),
        fetchAllPages<Change>(`${path}/changes`),
      ])
      return { workspace, changes }
    },
    enabled: workspaceName !== null && contentRepositoryId !== null,
    // Dirty markers should feel current while editing elsewhere.
    staleTime: 10_000,
  })
}

/** Publishes the workspace's changes to its base - all, or of a site or documents. */
export function publishWorkspace(
  workspaceName: string,
  scope: WorkspacePublish = {},
): Promise<PublishingResult> {
  return apiFetch<PublishingResult>(
    `${workspacesPath(workspaceName)}/publish`,
    {
      method: 'POST',
      body: scope,
    },
  )
}

/** Discards the workspace's changes - all, or of a site or documents. */
export function discardWorkspace(
  workspaceName: string,
  scope: WorkspaceDiscard = {},
): Promise<DiscardingResult> {
  return apiFetch<DiscardingResult>(
    `${workspacesPath(workspaceName)}/discard`,
    {
      method: 'POST',
      body: scope,
    },
  )
}

/**
 * Rebases the workspace onto the current state of its base - what the classic
 * UI calls "synchronize". A 409 conflict problem when own changes collide
 * with the incoming ones (see workspaceConflicts); "force" drops them.
 */
export async function rebaseWorkspace(
  workspaceName: string,
  strategy: 'fail' | 'force' = 'fail',
): Promise<void> {
  await apiFetch(`${workspacesPath(workspaceName)}/rebase`, {
    method: 'POST',
    body: { strategy },
  })
}

/**
 * Retargets where the workspace publishes to. A 409 while it still has
 * publishable changes (see isConflict).
 */
export async function changeBaseWorkspace(
  workspaceName: string,
  baseWorkspaceName: string,
): Promise<void> {
  await apiFetch(`${workspacesPath(workspaceName)}/baseworkspace`, {
    method: 'PUT',
    body: { baseWorkspaceName },
  })
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

export function createWorkspace(input: WorkspaceCreate): Promise<Workspace> {
  return apiFetch<Workspace>(workspacesPath(), { method: 'POST', body: input })
}

export function updateWorkspace(
  workspaceName: string,
  input: WorkspaceUpdate,
): Promise<Workspace> {
  return apiFetch<Workspace>(workspacesPath(workspaceName), {
    method: 'PATCH',
    body: input,
  })
}

/** With force, pending changes are discarded along with the workspace. */
export async function deleteWorkspace(
  workspaceName: string,
  force = false,
): Promise<void> {
  await apiFetch(
    `${workspacesPath(workspaceName)}${force ? queryString({ force: true }) : ''}`,
    { method: 'DELETE' },
  )
}

function rolePath(
  workspaceName: string,
  subject: WorkspaceRoleSubject,
): string {
  return `${workspacesPath(workspaceName)}/roles/${subject.type}/${encodeURIComponent(subject.id)}`
}

/** Who (a user or a Flow role group) may do what. Requires manage permission. */
export function useWorkspaceRoles(workspaceName: string | null) {
  const contentRepositoryId = useActiveContentRepositoryId()
  return useQuery({
    queryKey: neosKeys.workspaces.roles(
      contentRepositoryId ?? '',
      workspaceName ?? '',
    ),
    queryFn: async () =>
      (
        await apiFetch<Listing<WorkspaceRoleAssignment>>(
          `${workspacesPath(workspaceName!, contentRepositoryId!)}/roles`,
        )
      ).data,
    enabled: workspaceName !== null && contentRepositoryId !== null,
  })
}

/** Gives the subject the role; a role it had is replaced. */
export async function assignWorkspaceRole(
  workspaceName: string,
  subject: WorkspaceRoleSubject,
  role: WorkspaceRole,
): Promise<void> {
  await apiFetch(rolePath(workspaceName, subject), {
    method: 'PUT',
    body: { role },
  })
}

export async function unassignWorkspaceRole(
  workspaceName: string,
  subject: WorkspaceRoleSubject,
): Promise<void> {
  await apiFetch(rolePath(workspaceName, subject), { method: 'DELETE' })
}

/**
 * A page of the events of the workspace's current content stream: after a
 * sequence number (a 409 if it is of an earlier content stream - the
 * workspace was published, discarded or rebased since), or sorted, with what
 * each changed (include=diff) and its node and document (node, document).
 */
export function listWorkspaceEvents(
  workspaceName: string,
  params: { after?: number; sort?: string; limit?: number; include?: string },
  contentRepositoryId: string = activeContentRepositoryId(),
): Promise<PaginatedEventListing> {
  return apiFetch<PaginatedEventListing>(
    `${workspacesPath(workspaceName, contentRepositoryId)}/events${queryString(params)}`,
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
    filterByChangeType?: string
    filterByNodeType?: string
    include?: string
  },
): Promise<Change[]> {
  return fetchAllPages<Change>(
    `${workspacesPath(workspaceName, contentRepositoryId)}/changes${queryString(params)}`,
  )
}
