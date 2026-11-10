import {
  changeNodeType as changeNodeTypeRequest,
  deleteNode,
  moveNode as moveNodeRequest,
  PartialWriteError,
  runSequentially,
  tagNode,
  untagNode,
} from '@/api/neos/endpoints/nodeCommands'
import type { NodeAddress } from '@/api/neos/schema'
import { emitStudioEvent, type StructureChange } from '@/app/events'
import { afterStructuralEdit } from '@/features/workspaces/invalidate'

/**
 * Structural node actions behind the preview's element menu and move-drag:
 * hide, unhide, delete and move. All operate on the viewed (covered)
 * dimension space point like the classic UI - hide/unhide/delete reach the
 * points falling back to it as well, moves follow the node type's
 * moveNodeStrategy - so no variant creation is needed.
 */

/** For structureChange: the items are the written nodes' addresses. */
const identity = (address: NodeAddress) => address

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
  await structureChange('hidden', addresses, identity, (address) =>
    tagNode(address, 'disabled'),
  )
}

/** Removes the "disabled" subtree tag set by hideNodes. */
export async function unhideNodes(addresses: NodeAddress[]): Promise<void> {
  await structureChange('unhidden', addresses, identity, (address) =>
    untagNode(address, 'disabled'),
  )
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
  await structureChange('typeChanged', [address], identity, (a) =>
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
  await structureChange('deleted', addresses, identity, deleteNode)
}

/**
 * Moves one or more nodes in order (tree drags, the preview's move-drag, cut
 * and paste). Each node is placed
 * before the same succeeding sibling, so a multi-selection keeps its relative
 * order at the target ([A, B] before S becomes ...A, B, S).
 */
export async function moveNodesByAddress(
  moves: MoveByAddress[],
): Promise<void> {
  await structureChange(
    'moved',
    moves,
    // The move happens in the node's workspace (paste moves it into the
    // target's first, see pasteClipboardEntry).
    (move) => move.nodeAddress,
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
 * workspaces written to afterwards - also after a failure, as earlier writes
 * stay; those are announced (nodes.structureChanged) too. Resolves (or
 * rejects) once the writes are done: the refresh is not awaited - the node
 * reads are marked stale right away, so what the caller re-reads next
 * (trees, the inspection) is fetched fresh anyway.
 */
async function structureChange<T>(
  change: StructureChange,
  items: T[],
  addressOf: (item: T) => NodeAddress,
  write: (item: T) => Promise<unknown>,
): Promise<void> {
  if (items.length === 0) return
  let applied = 0
  try {
    await runSequentially(items, write)
    applied = items.length
  } catch (error) {
    if (error instanceof PartialWriteError) applied = error.applied
    throw error
  } finally {
    // Usually one workspace; a batch could in principle span several.
    const workspaces = new Map<string, NodeAddress[]>()
    items.forEach((item, index) => {
      const address = addressOf(item)
      const key = JSON.stringify([
        address.contentRepositoryId,
        address.workspaceName,
      ])
      const written = workspaces.get(key) ?? []
      if (index < applied) written.push(address)
      workspaces.set(key, written)
    })
    for (const [key, written] of workspaces) {
      const [contentRepositoryId, workspaceName] = JSON.parse(key) as [
        string,
        string,
      ]
      void afterStructuralEdit(contentRepositoryId, workspaceName)
      if (written.length > 0) {
        emitStudioEvent('nodes.structureChanged', {
          contentRepositoryId,
          workspaceName,
          change,
          nodeAggregateIds: written.map((address) => address.nodeAggregateId),
        })
      }
    }
  }
}
