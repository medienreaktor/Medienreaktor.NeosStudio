import { executeCommands } from '@/api/commands'
import { queryKeys } from '@/api/keys'
import { addressFromContextPath, decodeNodeAddress, encodeNodeAddress } from '@/api/nodeAddress'
import { queryClient } from '@/app/queryClient'

export interface CreateNodeRequest {
  nodeTypeName: string
  /** NodeAddress JSON of the collection the node is created in. */
  parentContextPath: string
  /** NodeAddress JSON of the sibling to insert before; null appends. */
  succeedingSiblingContextPath: string | null
}

/**
 * Creates a new node inside a content collection via the commands API and
 * returns the new node's address. The origin dimension space point is the
 * one being viewed - the parent collection covers it (it is rendered), which
 * is all CreateNodeAggregateWithNode requires, so no variant dance is needed.
 */
export async function createNode(
  request: CreateNodeRequest,
  initialPropertyValues: Record<string, unknown> = {},
): Promise<string> {
  const parent = decodeNodeAddress(addressFromContextPath(request.parentContextPath))
  const nodeAggregateId = crypto.randomUUID()

  const payload: Record<string, unknown> = {
    workspaceName: parent.workspaceName,
    nodeAggregateId,
    nodeTypeName: request.nodeTypeName,
    originDimensionSpacePoint: parent.dimensionSpacePoint,
    parentNodeAggregateId: parent.aggregateId,
  }
  if (request.succeedingSiblingContextPath !== null) {
    payload.succeedingSiblingNodeAggregateId = decodeNodeAddress(
      addressFromContextPath(request.succeedingSiblingContextPath),
    ).aggregateId
  }
  if (Object.keys(initialPropertyValues).length > 0) {
    payload.initialPropertyValues = initialPropertyValues
  }

  await executeCommands([{ type: 'CreateNodeAggregateWithNode', payload }])

  // The collection's children changed - drop all node reads (children lists
  // are keyed under nodes too) and refresh the pending-changes badges.
  await queryClient.invalidateQueries({ queryKey: queryKeys.nodes.all })
  void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all })

  return encodeNodeAddress({
    contentRepositoryId: parent.contentRepositoryId,
    workspaceName: parent.workspaceName,
    dimensionSpacePoint: parent.dimensionSpacePoint,
    aggregateId: nodeAggregateId,
  })
}
