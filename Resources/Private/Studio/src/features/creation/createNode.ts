import { createNode as createNodeRequest } from '@/api/neos/endpoints/nodeCommands'
import type { Node, NodeAddress } from '@/api/neos/schema'
import { createNodeFromCreationDialog } from '@/api/studio/endpoints/creationDialog'
import { emitStudioEvent } from '@/app/events'
import { recordCreation } from '@/features/editing/nodeActions'
import { afterStructuralEdit } from '@/features/workspaces/invalidate'
import { translate as t } from '@/lib/i18n'

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

  // The parent's children changed - refresh the workspace's node reads and
  // its pending changes. Not awaited: the reads are marked stale right away,
  // so whatever the caller reads next (the new node, the parent's children)
  // is fetched fresh; waiting for every active read to refetch first would
  // only delay the dialog.
  void afterStructuralEdit(
    request.parentAddress.contentRepositoryId,
    request.parentAddress.workspaceName,
  )
  emitStudioEvent('nodes.structureChanged', {
    contentRepositoryId: request.parentAddress.contentRepositoryId,
    workspaceName: request.parentAddress.workspaceName,
    change: 'created',
    nodeAggregateIds: [node.nodeAggregateId],
  })
  recordCreation([node], (subject) => t('undo.create', 'Create {0}', [subject]))

  return node
}
