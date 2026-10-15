import { createNode as createNodeRequest } from '@/api/neos/endpoints/nodeCommands'
import { neosKeys } from '@/api/neos/keys'
import type { Node, NodeAddress } from '@/api/neos/schema'
import { createNodeFromCreationDialog } from '@/api/studio/endpoints/creationDialog'
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
 * What the creation dialog asked for arrives here already split into property
 * values and references (see CreateNodeFlow). With `elements` - the dialog's
 * values, for a node type with node creation handlers - the node is created
 * through the Studio's createNodeFromCreationDialog, which runs the handlers
 * (Flowpack.NodeTemplates and the like) as the classic UI does; otherwise
 * through Neos.Api's createNode.
 */
export async function createNode(
  request: CreateNodeRequest,
  properties: Record<string, unknown> = {},
  /** Target node aggregate ids by reference name. */
  references: Record<string, string[]> = {},
  elements: Record<string, unknown> | null = null,
): Promise<Node> {
  const succeedingSiblingNodeAggregateId =
    request.succeedingSiblingAddress?.nodeAggregateId ?? null
  const node =
    elements !== null
      ? await createNodeFromCreationDialog(request.parentAddress, {
          nodeType: request.nodeTypeName,
          succeedingSiblingNodeAggregateId,
          properties,
          references: Object.fromEntries(
            Object.entries(references).map(([name, targets]) => [
              name,
              targets.map((nodeAggregateId) => ({ nodeAggregateId })),
            ]),
          ),
          elements,
        })
      : await createNodeRequest({
          nodeType: request.nodeTypeName,
          parent: request.parentAddress,
          succeedingSiblingNodeAggregateId,
          properties,
          references,
        })

  // The collection's children changed - drop all node reads (children lists
  // are keyed under nodes too) and refresh the pending-changes badges.
  await queryClient.invalidateQueries({ queryKey: neosKeys.nodes.all })
  void queryClient.invalidateQueries({ queryKey: neosKeys.workspaces.all })

  return node
}
