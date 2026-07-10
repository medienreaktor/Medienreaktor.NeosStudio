import { useMemo } from 'react'
import { useWorkspaceChanges } from '@/api/workspaces'

export interface PendingChanges {
  workspace: string
  /** Aggregate ids of nodes with own pending changes. */
  ids: ReadonlySet<string>
  /** Aggregate ids of documents containing pending changes (own or within). */
  documentIds: ReadonlySet<string>
}

/**
 * Pending changes of the active workspace relative to its base - the trees
 * browse that same workspace, so "dirty" means "will be published from here".
 */
export function usePendingChanges(workspaceName: string | null): PendingChanges | null {
  const { data: changesResponse } = useWorkspaceChanges(workspaceName)

  return useMemo(() => {
    if (workspaceName === null || !changesResponse) return null
    return {
      workspace: workspaceName,
      ids: new Set(changesResponse.changes.map((c) => c.nodeAggregateId)),
      documentIds: new Set(
        changesResponse.changes.flatMap((c) => (c.documentAggregateId === null ? [] : [c.documentAggregateId])),
      ),
    }
  }, [workspaceName, changesResponse])
}
