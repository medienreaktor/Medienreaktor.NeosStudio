import { useMemo } from 'react'
import { useWorkspaceChanges } from '@/api/neos/endpoints/workspaces'
import { type Node, sameDimensionSpacePoint } from '@/api/neos/schema'

/**
 * Origin dimension space points of pending changes by aggregate id. A change
 * without an origin (null) applies to every dimension of the aggregate.
 */
type ChangeOrigins = ReadonlyMap<string, readonly (string | null)[]>

export interface PendingChanges {
  workspace: string
  /** Nodes with own pending changes. */
  ids: ChangeOrigins
  /** Documents containing pending changes (own or within). */
  documentIds: ChangeOrigins
}

/**
 * Pending changes of the active workspace relative to its base - the trees
 * browse that same workspace, so "dirty" means "will be published from here".
 * The changes span every dimension; which of them concern a row is decided
 * per node (see {@link hasPendingChange}).
 */
export function usePendingChanges(
  workspaceName: string | null,
): PendingChanges | null {
  const { data: changesResponse } = useWorkspaceChanges(workspaceName)

  return useMemo(() => {
    if (workspaceName === null || !changesResponse) return null
    const ids = new Map<string, (string | null)[]>()
    const documentIds = new Map<string, (string | null)[]>()
    const add = (
      map: Map<string, (string | null)[]>,
      id: string,
      origin: string | null,
    ) => {
      const origins = map.get(id)
      if (origins) origins.push(origin)
      else map.set(id, [origin])
    }
    for (const change of changesResponse.changes) {
      add(ids, change.nodeAggregateId, change.originDimensionSpacePoint)
      if (change.documentAggregateId !== null)
        add(
          documentIds,
          change.documentAggregateId,
          change.originDimensionSpacePoint,
        )
    }
    return { workspace: workspaceName, ids, documentIds }
  }, [workspaceName, changesResponse])
}

/**
 * Whether a pending change in `origins` concerns this node as the tree shows
 * it - in its subgraph's dimension space point. A change in another language
 * of the same aggregate is not a change of this row: it matches when made in
 * the row's own dimension space point, or in the origin its content comes
 * from (a shine-through row shows the fallback's content, and that
 * fallback's changes), or without any origin at all.
 */
export function hasPendingChange(
  origins: ChangeOrigins,
  node: Pick<
    Node,
    'nodeAggregateId' | 'dimensionSpacePoint' | 'originDimensionSpacePoint'
  >,
): boolean {
  return (
    origins
      .get(node.nodeAggregateId)
      ?.some(
        (origin) =>
          origin === null ||
          sameDimensionSpacePoint(origin, node.dimensionSpacePoint) ||
          sameDimensionSpacePoint(origin, node.originDimensionSpacePoint),
      ) ?? false
  )
}
