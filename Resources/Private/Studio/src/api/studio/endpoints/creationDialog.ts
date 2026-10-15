import { queryString } from '../../http/request'
import { contentRepositoryPath } from '../../neos/client'
import type { Node, NodeAddress } from '../../neos/schema'
import { studioFetch } from '../client'
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
  return studioFetch<Node>(
    `${contentRepositoryPath(parent.contentRepositoryId)}/creationdialog${queryString(
      {
        workspaceName: parent.workspaceName,
        dimensionSpacePoint: parent.dimensionSpacePoint,
      },
    )}`,
    {
      method: 'POST',
      body: {
        ...node,
        parentNodeAggregateId: parent.nodeAggregateId,
      } satisfies CreationDialogNodeCreate,
    },
  )
}
