import {
  type DragTarget,
  dragAndDropFeature,
  type ItemInstance,
} from '@headless-tree/core'
import { queryKeys } from '@/api/keys'
import { documentAccessState } from '@/features/access/useAccess'
import { fetchAllowedChildNodeTypes, type NodeDto } from '@/api/nodes'
import { queryClient } from '@/app/queryClient'
import { toast } from '@/components/ui/toast'
import { translate as t } from '@/lib/i18n'
import {
  type MoveByAddress,
  moveNodesByAddress,
} from '@/features/editing/nodeActions'

/**
 * Builds the drag-and-drop half of a `useTree` config, shared by the document
 * tree and the content outliner. Moving nodes dispatches a MoveNodeAggregate
 * batch to the content repository (see {@link moveNodesByAddress}); the model's
 * node-type constraints are enforced against the server-computed allowed-child
 * list of the drop target, so an element can only land where the content model
 * permits it.
 *
 * Returns the feature to add and the config fields to spread into `useTree`.
 * `getNode` maps a tree's item data to a real node (or null for its virtual
 * root / loading placeholders); the tree stays the single owner of that shape.
 */
export function buildTreeDnd<T>({
  getNode,
  onMoved,
}: {
  getNode: (data: T) => NodeDto | null
  /** Addresses whose child lists changed (old + new parents) - refresh them. */
  onMoved: (affectedAddresses: string[]) => void
}) {
  const nodeOf = (item: ItemInstance<T>): NodeDto | null =>
    getNode(item.getItemData())

  /** The intended new parent of a drop - `target.item` in both drop modes. */
  const allowedTypesOf = (address: string): string[] | undefined =>
    queryClient.getQueryData<string[]>(
      queryKeys.nodes.allowedChildNodeTypes(address),
    )

  return {
    feature: dragAndDropFeature,
    config: {
      canReorder: true,
      // Match TreeList's 14px-per-level indentation so the drop line and
      // reparent-by-horizontal-drag thresholds line up with the rendered rows.
      indent: 14,
      reorderAreaPercentage: 0.3,

      // The move is driven entirely by the tree's internal draggedItems state,
      // but a native drag only starts in some browsers (Firefox) once
      // dataTransfer carries data - so publish a token payload.
      createForeignDragObject: (items: ItemInstance<T>[]) => ({
        format: 'text/plain',
        data: items.map((item) => item.getId()).join('\n'),
      }),
      // Never accept a drag that started in another tree. Each tree is its own
      // headless-tree instance with its own draggedItems; a drag from the other
      // tree arrives here only as a "foreign" object. Refusing every foreign
      // object keeps the document tree and the content outliner strictly
      // separate - a document can never be dropped into content, or vice versa.
      canDropForeignDragObject: () => false,
      canDragForeignDragObjectOver: () => false,

      canDrag: (items: ItemInstance<T>[]): boolean => {
        // Only real, non-anchored, non-tethered nodes can be moved. The
        // visible root (site / document, level 0) is the tree's anchor;
        // tethered nodes (autocreated collections) have a fixed position.
        const draggable = items.every((item) => {
          const node = nodeOf(item)
          return (
            node !== null &&
            item.getItemMeta().level > 0 &&
            node.classification !== 'tethered' &&
            node.classification !== 'root' &&
            // A move is a write on the node itself - refused outside the
            // account's access roles, so it must not start.
            documentAccessState(node) === 'allowed'
          )
        })
        if (!draggable) return false
        // canDrop runs synchronously on every dragover, so the allowed-child
        // lists of the potential parents must already be cached. Warm every
        // loaded node now (drag start), not just the visible rows - a folder
        // that auto-opens mid-drag was loaded and thus covered here.
        const tree = items[0]?.getTree()
        for (const item of tree?.getItems() ?? []) {
          const node = nodeOf(item)
          if (node && allowedTypesOf(node.address) === undefined) {
            void fetchAllowedChildNodeTypes(node.address)
          }
        }
        return true
      },

      canDrop: (items: ItemInstance<T>[], target: DragTarget<T>): boolean => {
        // headless-tree already blocks dropping onto self or into own subtree.
        // Only the node-type constraint of the new parent remains to check.
        const parent = nodeOf(target.item)
        if (parent === null) return false
        // The new parent gains a child, which is a write on IT - a page
        // outside the roles takes none.
        if (documentAccessState(parent) !== 'allowed') return false
        const allowed = allowedTypesOf(parent.address)
        if (allowed === undefined) {
          // Not warmed yet (e.g. a just-loaded row): fetch and disallow for
          // now; the next dragover over a fresh position re-evaluates.
          void fetchAllowedChildNodeTypes(parent.address)
          return false
        }
        return items.every((item) => {
          const node = nodeOf(item)
          return node !== null && allowed.includes(node.nodeType)
        })
      },

      onDrop: async (
        items: ItemInstance<T>[],
        target: DragTarget<T>,
      ): Promise<void> => {
        const parent = nodeOf(target.item)
        if (parent === null) return

        // Succeeding sibling: the child at the insertion index among the
        // parent's children with the moved nodes removed (they are not their
        // own siblings). Absent index (dropped onto a folder) or past the end
        // appends.
        let succeedingSiblingAddress: string | null = null
        if ('insertionIndex' in target) {
          const draggedIds = new Set(items.map((item) => item.getId()))
          const remaining = target.item
            .getChildren()
            .filter((child) => !draggedIds.has(child.getId()))
          const sibling = remaining[target.insertionIndex]
          succeedingSiblingAddress = sibling
            ? (nodeOf(sibling)?.address ?? null)
            : null
        }

        const moves: MoveByAddress[] = []
        const affected = new Set<string>([parent.address])
        for (const item of items) {
          const node = nodeOf(item)
          if (node === null) continue
          moves.push({
            nodeAddress: node.address,
            newParentAddress: parent.address,
            succeedingSiblingAddress,
          })
          const oldParent = item.getParent()
          const oldParentNode = oldParent ? nodeOf(oldParent) : null
          if (oldParentNode) affected.add(oldParentNode.address)
        }
        if (moves.length === 0) return

        try {
          await moveNodesByAddress(moves)
          onMoved([...affected])
        } catch (e) {
          toast.error(e, { title: t('editing.moveFailed', 'Moving failed') })
        }
      },
    },
  }
}
