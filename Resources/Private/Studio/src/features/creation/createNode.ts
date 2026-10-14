import { createNode as createNodeRequest } from '@/api/commands'
import { queryKeys } from '@/api/keys'
import { queryClient } from '@/app/queryClient'

export interface CreateNodeRequest {
  nodeTypeName: string
  /** Address of the node the new node is created in. */
  parentAddress: string
  /** Address of the sibling to insert before; null appends. */
  succeedingSiblingAddress: string | null
}

/**
 * Creates a new node inside a parent and returns the new node's address. The
 * origin dimension space point is the one being viewed - the parent covers it
 * (it is rendered/browsed), which is all node creation requires, so no
 * variant dance is needed.
 */
export async function createNode(
  request: CreateNodeRequest,
  initialPropertyValues: Record<string, unknown> = {},
  /**
   * Creation-dialog element values (serialized form). The API runs the node
   * type's server-side nodeCreationHandlers with them (promoted elements,
   * Flowpack.NodeTemplates, ...) - classic-UI parity. Explicit
   * initialPropertyValues win over handler output.
   */
  elements: Record<string, unknown> = {},
): Promise<string> {
  const node = await createNodeRequest({
    nodeTypeName: request.nodeTypeName,
    parentAddress: request.parentAddress,
    succeedingSiblingAddress: request.succeedingSiblingAddress,
    properties: initialPropertyValues,
    elements,
  })

  // The collection's children changed - drop all node reads (children lists
  // are keyed under nodes too) and refresh the pending-changes badges.
  await queryClient.invalidateQueries({ queryKey: queryKeys.nodes.all })
  void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all })

  return node.address
}
