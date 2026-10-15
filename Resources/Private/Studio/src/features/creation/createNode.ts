import { createNode as createNodeRequest } from '@/api/neos/endpoints/nodeCommands'
import { neosKeys } from '@/api/neos/keys'
import type { Node, NodeAddress } from '@/api/neos/schema'
import { studioKeys } from '@/api/studio/keys'
import { queryClient } from '@/app/queryClient'

export interface CreateNodeRequest {
  nodeTypeName: string
  /** The node the new node is created in. */
  parentAddress: NodeAddress
  /** The sibling to insert before; null appends. */
  succeedingSiblingAddress: NodeAddress | null
}

/**
 * Creates a new node inside a parent and resolves with it. The origin
 * dimension space point is the one being viewed - the parent covers it (it is
 * rendered/browsed), which is all node creation requires, so no variant
 * dance is needed.
 *
 * Neos.Api runs no node creation handlers: what the creation dialog asked
 * for arrives here already split into property values and references (see
 * CreateNodeFlow). Handler-driven extras of the classic UI
 * (Flowpack.NodeTemplates and the like) do not run.
 */
export async function createNode(
  request: CreateNodeRequest,
  properties: Record<string, unknown> = {},
  /** Target node aggregate ids by reference name. */
  references: Record<string, string[]> = {},
): Promise<Node> {
  const node = await createNodeRequest({
    nodeType: request.nodeTypeName,
    parent: request.parentAddress,
    succeedingSiblingNodeAggregateId:
      request.succeedingSiblingAddress?.nodeAggregateId ?? null,
    properties,
    references,
  })

  // The collection's children changed - drop all node reads (children lists
  // are keyed under nodes too) and refresh the pending-changes badges.
  await queryClient.invalidateQueries({ queryKey: neosKeys.nodes.all })
  void queryClient.invalidateQueries({ queryKey: neosKeys.workspaces.all })
  void queryClient.invalidateQueries({ queryKey: studioKeys.workspaces.all })

  return node
}
