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
  permissions: { read: boolean; write: boolean; manage: boolean }
}

export interface WorkspaceChange {
  nodeAggregateId: string
  /** Closest containing document (the node itself if it is a document). */
  documentAggregateId: string | null
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
  return apiFetch(`/workspaces/${encodeURIComponent(workspaceName)}/publish`, { method: 'POST', body: filter })
}

/** Discard pending changes of the workspace. */
export function discardWorkspace(
  workspaceName: string,
  filter?: WorkspaceOperationFilter,
): Promise<{ workspace: string; discardedChanges: number }> {
  return apiFetch(`/workspaces/${encodeURIComponent(workspaceName)}/discard`, { method: 'POST', body: filter })
}

export function useWorkspaceChanges(workspaceName: string | null) {
  return useQuery({
    queryKey: queryKeys.workspaces.changes(workspaceName ?? ''),
    queryFn: () =>
      apiFetch<{ workspace: string; baseWorkspace: string | null; changes: WorkspaceChange[] }>(
        `/workspaces/${encodeURIComponent(workspaceName!)}/changes`,
      ),
    enabled: workspaceName !== null,
    // Dirty markers should feel current while editing elsewhere.
    staleTime: 10_000,
  })
}
