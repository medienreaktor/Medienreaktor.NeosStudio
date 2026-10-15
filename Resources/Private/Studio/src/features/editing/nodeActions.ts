import {
  changeNodeType as changeNodeTypeRequest,
  deleteNode,
  moveNode as moveNodeRequest,
  runSequentially,
  tagNode,
  untagNode,
} from '@/api/neos/endpoints/nodeCommands'
import { neosKeys } from '@/api/neos/keys'
import { type NodeAddress, nodeAddressFromContextPath } from '@/api/neos/schema'
import { queryClient } from '@/app/queryClient'

/**
 * Structural node actions behind the preview's element menu and move-drag:
 * hide, unhide, delete and move. All operate on the viewed (covered)
 * dimension space point like the classic UI - hide/unhide/delete reach the
 * points falling back to it as well, moves follow the node type's
 * moveNodeStrategy - so no variant creation is needed.
 */

export interface MoveNodeRequest {
  /** NodeAddress JSON of the element being moved. */
  nodeContextPath: string
  /** NodeAddress JSON of the target collection. */
  parentContextPath: string
  /** NodeAddress JSON of the sibling to insert before; null appends. */
  succeedingSiblingContextPath: string | null
}

/** One move for {@link moveNodesByAddress}. */
export interface MoveByAddress {
  /** The node being moved. */
  nodeAddress: NodeAddress
  /** The new parent. */
  newParentAddress: NodeAddress
  /** The sibling to insert before; null appends. */
  succeedingSiblingAddress: NodeAddress | null
}

export async function hideNodes(addresses: NodeAddress[]): Promise<void> {
  await structureChange(addresses, (address) => tagNode(address, 'disabled'))
}

/** Removes the "disabled" subtree tag set by hideNodes. */
export async function unhideNodes(addresses: NodeAddress[]): Promise<void> {
  await structureChange(addresses, (address) => untagNode(address, 'disabled'))
}

/**
 * Changes a node's type. The server applies Neos' semantics: properties the
 * new type does not declare are dropped, child nodes it does not allow are
 * deleted (soft, restorable); a parent that does not allow the new type
 * fails the change.
 */
export async function changeNodeType(
  address: NodeAddress,
  newNodeTypeName: string,
): Promise<void> {
  await structureChange([address], (a) =>
    changeNodeTypeRequest(a, newNodeTypeName),
  )
}

/**
 * Deletes nodes - a SOFT removal, the way Neos deletes in a non-live
 * workspace: the node is tagged "removed" instead of being erased. Every read
 * (trees, preview, search) excludes that tag, so it is gone for the editor,
 * but the change stays a reviewable pending change of a node that still
 * exists. That is what lets the review dialog name what was deleted, publish
 * or discard the deletion per document, and restore it. The content
 * repository turns the soft removal into a hard one in live once the
 * deletion is published and no other workspace still needs the node.
 */
export async function deleteNodes(addresses: NodeAddress[]): Promise<void> {
  await structureChange(addresses, deleteNode)
}

export async function moveNode(request: MoveNodeRequest): Promise<void> {
  await moveNodesByAddress([
    {
      nodeAddress: nodeAddressFromContextPath(request.nodeContextPath),
      newParentAddress: nodeAddressFromContextPath(request.parentContextPath),
      succeedingSiblingAddress:
        request.succeedingSiblingContextPath !== null
          ? nodeAddressFromContextPath(request.succeedingSiblingContextPath)
          : null,
    },
  ])
}

/**
 * Moves one or more nodes in order, addressing them by NodeAddress (what the
 * trees carry) rather than the guest's JSON context paths. Each node is placed before the same succeeding sibling, so a
 * multi-selection keeps its relative order at the target ([A, B] before S
 * becomes ...A, B, S).
 */
export async function moveNodesByAddress(
  moves: MoveByAddress[],
): Promise<void> {
  await structureChange(
    moves,
    ({ nodeAddress, newParentAddress, succeedingSiblingAddress }) =>
      moveNodeRequest(
        nodeAddress,
        newParentAddress.nodeAggregateId,
        succeedingSiblingAddress?.nodeAggregateId ?? null,
      ),
  )
}

/**
 * Runs one write per item in order (see runSequentially) and refreshes the
 * node reads afterwards - also after a failure, as earlier writes stay.
 */
async function structureChange<T>(
  items: T[],
  write: (item: T) => Promise<unknown>,
): Promise<void> {
  if (items.length === 0) return
  try {
    await runSequentially(items, write)
  } finally {
    await invalidateAfterStructureChange()
  }
}

/**
 * Children lists changed - drop all node reads (children are keyed under
 * nodes) and refresh the pending-changes badges.
 */
async function invalidateAfterStructureChange(): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: neosKeys.nodes.all })
  void queryClient.invalidateQueries({ queryKey: neosKeys.workspaces.all })
}
