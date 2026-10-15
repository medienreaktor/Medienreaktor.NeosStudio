import { api, unwrap } from '../../neos/client'
import type { Node, NodeAddress } from '../../neos/schema'
import type { CreationDialogNodeCreate } from '../schema'

/**
 * Creates a node below the parent through its creation dialog, as the Neos UI
 * does: Neos.Api's createNode, then the node type's node creation handlers
 * (Flowpack.NodeTemplates and the like) with the dialog's values as elements.
 * The properties and references given win over what the handlers set.
 */
export function createNodeFromCreationDialog(
  parent: NodeAddress,
  node: Omit<CreationDialogNodeCreate, 'parentNodeAggregateId'>,
): Promise<Node> {
  return unwrap(
    api.POST('/cr/{contentRepositoryId}/creationdialog', {
      params: {
        path: { contentRepositoryId: parent.contentRepositoryId },
        query: {
          workspaceName: parent.workspaceName,
          dimensionSpacePoint: parent.dimensionSpacePoint,
        },
      },
      body: {
        ...node,
        parentNodeAggregateId: parent.nodeAggregateId,
      } satisfies CreationDialogNodeCreate,
    }),
  )
}
