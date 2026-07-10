import { useMemo } from 'react'
import { useWorkspaceChanges, useWorkspaces } from '@/api/workspaces'

export interface PendingChanges {
  workspace: string
  /** Aggregate ids of nodes with own pending changes. */
  ids: ReadonlySet<string>
  /** Aggregate ids of documents containing pending changes (own or within). */
  documentIds: ReadonlySet<string>
}

/**
 * Pending changes to mark nodes as "dirty" in the trees. The trees browse
 * live, so "dirty" means: modified in the user's personal workspace relative
 * to its base. Until Studio grows a workspace switcher, the first writable
 * personal workspace is used.
 */
export function usePendingChanges(): PendingChanges | null {
  const { data: workspacesResponse } = useWorkspaces()
  const workspace =
    workspacesResponse?.workspaces.find((w) => w.classification === 'PERSONAL' && w.permissions.write) ?? null

  const { data: changesResponse } = useWorkspaceChanges(workspace?.name ?? null)

  return useMemo(() => {
    if (!workspace || !changesResponse) return null
    return {
      workspace: workspace.name,
      ids: new Set(changesResponse.changes.map((c) => c.nodeAggregateId)),
      documentIds: new Set(
        changesResponse.changes.flatMap((c) => (c.documentAggregateId === null ? [] : [c.documentAggregateId])),
      ),
    }
  }, [workspace, changesResponse])
}
