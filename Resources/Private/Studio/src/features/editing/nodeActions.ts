import {
  changeNodeType as changeNodeTypeRequest,
  deleteNode,
  moveNode as moveNodeRequest,
  PartialWriteError,
  restoreNode,
  runSequentially,
  tagNode,
  untagNode,
} from '@/api/neos/endpoints/nodeCommands'
import { getNode } from '@/api/neos/endpoints/nodes'
import { type Node, type NodeAddress, nodeAddressOf } from '@/api/neos/schema'
import { emitStudioEvent, type StructureChange } from '@/app/events'
import {
  type HistoryEntry,
  recordHistory,
} from '@/features/history/historyStore'
import { cachedNodeLabel, nodesSubject } from '@/features/history/labels'
import {
  locate,
  locateBelow,
  located,
  locatedAt,
} from '@/features/history/location'
import { afterStructuralEdit } from '@/features/workspaces/invalidate'
import { translate as t } from '@/lib/i18n'

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

/**
 * Whether a write goes into the undo history - false for the writes of an
 * undo/redo itself.
 */
export interface RecordOption {
  record?: boolean
}

/**
 * Records the nodes a structural edit was applied to (all, or the ones
 * before a failure) - as one undo step, its inverse undoing them in reverse
 * order.
 */
function recordStructureEdit(
  addresses: NodeAddress[],
  label: (subject: string) => string,
  undo: (addresses: NodeAddress[]) => Promise<void>,
  redo: (addresses: NodeAddress[]) => Promise<void>,
  options: {
    /** The nodes' labels, if known - else read from the cache. */
    labels?: (string | null)[]
    /** Where it is seen, if read before the edit - else the first node now. */
    where?: HistoryEntry['where']
  } = {},
): void {
  const [first] = addresses
  if (!first) return
  const subject = nodesSubject(options.labels ?? addresses.map(cachedNodeLabel))
  recordHistory({
    workspace: first,
    label: () => label(subject()),
    undo: () => undo([...addresses].reverse()),
    redo: () => redo(addresses),
    where: options.where ?? locatedAt(first),
  })
}

export async function hideNodes(
  addresses: NodeAddress[],
  { record = true }: RecordOption = {},
): Promise<void> {
  await structureChange(
    'hidden',
    addresses,
    identity,
    (address) => tagNode(address, 'disabled'),
    (applied) =>
      record &&
      recordStructureEdit(
        applied,
        (subject) => t('undo.hide', 'Hide {0}', [subject]),
        (nodes) => unhideNodes(nodes, { record: false }),
        (nodes) => hideNodes(nodes, { record: false }),
      ),
  )
}

/** Removes the "disabled" subtree tag set by hideNodes. */
export async function unhideNodes(
  addresses: NodeAddress[],
  { record = true }: RecordOption = {},
): Promise<void> {
  await structureChange(
    'unhidden',
    addresses,
    identity,
    (address) => untagNode(address, 'disabled'),
    (applied) =>
      record &&
      recordStructureEdit(
        applied,
        (subject) => t('undo.unhide', 'Unhide {0}', [subject]),
        (nodes) => hideNodes(nodes, { record: false }),
        (nodes) => unhideNodes(nodes, { record: false }),
      ),
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
export async function deleteNodes(
  addresses: NodeAddress[],
  { record = true }: RecordOption = {},
): Promise<void> {
  // Where the first node is seen - read while it still exists.
  const [first] = addresses
  const at = record && first ? located(await locate(first)) : null
  await structureChange(
    'deleted',
    addresses,
    identity,
    deleteNode,
    (applied) =>
      record &&
      recordStructureEdit(
        applied,
        (subject) => t('undo.delete', 'Delete {0}', [subject]),
        (nodes) => restoreNodes(nodes),
        (nodes) => deleteNodes(nodes, { record: false }),
        at ? { where: { undo: at, redo: at } } : {},
      ),
  )
}

/**
 * Restores deleted nodes (with the deleted ancestors they live inside), as
 * the trash does - undoes deleteNodes until the deletion is published. Not
 * recorded: it is what undo runs.
 */
export async function restoreNodes(addresses: NodeAddress[]): Promise<void> {
  await structureChange('restored', addresses, identity, restoreNode)
}

/**
 * Records the creation of nodes (created, pasted copies) for undo: undoing
 * deletes them - soft, so the review still lists them as removed until the
 * workspace's changes are discarded - and redoing restores them.
 */
export function recordCreation(
  nodes: Node[],
  label: (subject: string) => string,
): void {
  recordStructureEdit(
    nodes.map(nodeAddressOf),
    label,
    (addresses) => deleteNodes(addresses, { record: false }),
    (addresses) => restoreNodes(addresses),
    { labels: nodes.map((node) => node.label) },
  )
}

/**
 * Moves one or more nodes in order (tree drags, the preview's move-drag, cut
 * and paste). Each node is placed
 * before the same succeeding sibling, so a multi-selection keeps its relative
 * order at the target ([A, B] before S becomes ...A, B, S).
 */
export async function moveNodesByAddress(
  moves: MoveByAddress[],
  { record = true }: RecordOption = {},
): Promise<void> {
  // Where the nodes are now - what undoing the moves puts them back to.
  const [firstMove] = moves
  const [origins, originLocation] =
    record && firstMove
      ? await Promise.all([originsOf(moves), locate(firstMove.nodeAddress)])
      : [null, null]
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
    (applied) => {
      if (!origins) return
      const [first] = applied
      if (!first) return
      const subject = nodesSubject(
        applied.map((move) => origins.get(move)?.label ?? null),
      )
      // Back in reverse order: a node's former succeeding sibling may be one
      // moved along with it, which has to be back in place first.
      const back = applied
        .map((move) => origins.get(move))
        .filter((origin): origin is Origin => origin !== undefined)
        .map((origin) => origin.move)
        .reverse()
      // A node whose origin is unknown can't be put back: no undo then.
      if (back.length !== applied.length) return
      recordHistory({
        workspace: first.nodeAddress,
        where: {
          undo: located(originLocation),
          redo: located(locateBelow(first.nodeAddress, first.newParentAddress)),
        },
        label: () => t('undo.move', 'Move {0}', [subject()]),
        undo: () => moveNodesByAddress(back, { record: false }),
        redo: () => moveNodesByAddress(applied, { record: false }),
      })
    },
  )
}

/** Where a node was before a move, as the move putting it back. */
interface Origin {
  label: string
  move: MoveByAddress
}

/**
 * Reads where the nodes are - parent and succeeding sibling - before moving
 * them. Undefined for a node that can't be read (the move fails anyway, or
 * goes unrecorded).
 */
async function originsOf(
  moves: MoveByAddress[],
): Promise<Map<MoveByAddress, Origin>> {
  const origins = new Map<MoveByAddress, Origin>()
  await Promise.all(
    moves.map(async (move) => {
      try {
        const node = await getNode(move.nodeAddress, { include: 'ancestors' })
        const parent = node.ancestors?.[0]
        if (!parent) return
        const parentAddress = nodeAddressOf(parent)
        const children =
          (await getNode(parentAddress, { include: 'children' })).children ?? []
        const index = children.findIndex(
          (child) => child.nodeAggregateId === node.nodeAggregateId,
        )
        const next = index >= 0 ? children[index + 1] : undefined
        origins.set(move, {
          label: node.label,
          move: {
            nodeAddress: move.nodeAddress,
            newParentAddress: parentAddress,
            succeedingSiblingAddress: next ? nodeAddressOf(next) : null,
          },
        })
      } catch (error) {
        console.warn('Could not read where a moved node was, for undo:', error)
      }
    }),
  )
  return origins
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
  /** The items written, also before a failure - for the undo history. */
  onApplied?: (applied: T[]) => unknown,
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
    if (applied > 0) onApplied?.(items.slice(0, applied))
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
