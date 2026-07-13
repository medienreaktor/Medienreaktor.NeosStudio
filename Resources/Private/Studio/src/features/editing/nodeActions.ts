import { executeCommands } from '@/api/commands'
import { queryKeys } from '@/api/keys'
import { addressFromContextPath, decodeNodeAddress } from '@/api/nodeAddress'
import { queryClient } from '@/app/queryClient'

/**
 * Structural node actions behind the preview's element menu and move-drag:
 * hide, unhide, delete and move. All operate on the viewed (covered)
 * dimension space point with the classic UI's strategies -
 * "allSpecializations" for hide/unhide/delete, "gatherAll" for moves - so no
 * variant creation is needed.
 */

export interface MoveNodeRequest {
  /** NodeAddress JSON of the element being moved. */
  nodeContextPath: string
  /** NodeAddress JSON of the target collection. */
  parentContextPath: string
  /** NodeAddress JSON of the sibling to insert before; null appends. */
  succeedingSiblingContextPath: string | null
}

export async function hideNode(address: string): Promise<void> {
  const node = decodeNodeAddress(address)
  await executeCommands([
    {
      type: 'DisableNodeAggregate',
      payload: {
        workspaceName: node.workspaceName,
        nodeAggregateId: node.aggregateId,
        coveredDimensionSpacePoint: node.dimensionSpacePoint,
        nodeVariantSelectionStrategy: 'allSpecializations',
      },
    },
  ])
  await invalidateAfterStructureChange()
}

/** Removes the "disabled" subtree tag set by hideNode. */
export async function unhideNode(address: string): Promise<void> {
  const node = decodeNodeAddress(address)
  await executeCommands([
    {
      type: 'EnableNodeAggregate',
      payload: {
        workspaceName: node.workspaceName,
        nodeAggregateId: node.aggregateId,
        coveredDimensionSpacePoint: node.dimensionSpacePoint,
        nodeVariantSelectionStrategy: 'allSpecializations',
      },
    },
  ])
  await invalidateAfterStructureChange()
}

export async function deleteNode(address: string): Promise<void> {
  const node = decodeNodeAddress(address)
  await executeCommands([
    {
      type: 'RemoveNodeAggregate',
      payload: {
        workspaceName: node.workspaceName,
        nodeAggregateId: node.aggregateId,
        coveredDimensionSpacePoint: node.dimensionSpacePoint,
        nodeVariantSelectionStrategy: 'allSpecializations',
      },
    },
  ])
  await invalidateAfterStructureChange()
}

export async function moveNode(request: MoveNodeRequest): Promise<void> {
  const node = decodeNodeAddress(addressFromContextPath(request.nodeContextPath))
  const parent = decodeNodeAddress(addressFromContextPath(request.parentContextPath))
  const payload: Record<string, unknown> = {
    workspaceName: node.workspaceName,
    dimensionSpacePoint: node.dimensionSpacePoint,
    nodeAggregateId: node.aggregateId,
    newParentNodeAggregateId: parent.aggregateId,
    relationDistributionStrategy: 'gatherAll',
  }
  if (request.succeedingSiblingContextPath !== null) {
    payload.newSucceedingSiblingNodeAggregateId = decodeNodeAddress(
      addressFromContextPath(request.succeedingSiblingContextPath),
    ).aggregateId
  }
  await executeCommands([{ type: 'MoveNodeAggregate', payload }])
  await invalidateAfterStructureChange()
}

/**
 * Children lists changed - drop all node reads (children are keyed under
 * nodes) and refresh the pending-changes badges.
 */
async function invalidateAfterStructureChange(): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: queryKeys.nodes.all })
  void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all })
}
