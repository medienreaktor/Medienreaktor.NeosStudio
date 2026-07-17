import { useQuery } from '@tanstack/react-query'
import { apiFetch } from './client'
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

export function useWorkspaces(enabled = true) {
  return useQuery({
    queryKey: queryKeys.workspaces.all,
    queryFn: () => apiFetch<{ workspaces: Workspace[] }>('/workspaces'),
    enabled,
  })
}

/** Scopes a publish/discard to one site or one document; empty = whole workspace. */
export interface WorkspaceOperationFilter {
  site?: string
  document?: string
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
