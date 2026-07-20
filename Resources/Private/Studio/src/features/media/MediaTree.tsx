import { useEffect, useMemo, useRef } from 'react'
import {
  type DragTarget,
  dragAndDropFeature,
  expandAllFeature,
  hotkeysCoreFeature,
  type ItemInstance,
  selectionFeature,
  syncDataLoaderFeature,
} from '@headless-tree/core'
import { useTree } from '@headless-tree/react'

import type { MediaCollection, MediaTag } from '@/api/media'
import type { TreeRowDecor } from '@/features/tree/nodeDecor'
import { TreeList } from '@/features/tree/TreeList'

/** A node in a media tree (a tag with children, or a flat collection). */
export interface MediaTreeNode {
  id: string
  label: string
  count: number
  children: MediaTreeNode[]
}

export function tagToNode(tag: MediaTag): MediaTreeNode {
  return {
    id: tag.identifier,
    label: tag.label,
    count: tag.assetCount,
    children: tag.children.map(tagToNode),
  }
}

export function collectionToNode(collection: MediaCollection): MediaTreeNode {
  return {
    id: collection.identifier,
    label: collection.title,
    count: collection.assetCount,
    children: [],
  }
}

const ROOT_ID = '__media_tree_root__'
type Data = MediaTreeNode | typeof ROOT_ID

/** True if `id` is `node` itself or one of its descendants. */
function subtreeContains(node: MediaTreeNode, id: string): boolean {
  if (node.id === id) return true
  return node.children.some((child) => subtreeContains(child, id))
}

/**
 * The collections list and tag tree, rendered with the same headless-tree
 * stack and TreeList component as the document tree / content outliner, so
 * they look and behave identically (indentation, chevrons, selection,
 * right-click). Data is loaded synchronously from the already-fetched nested
 * structure. When onReparent is given (tags), rows are draggable and dropping
 * one onto another - or between top-level rows - reparents it.
 */
export function MediaTree({
  roots,
  label,
  emptyText,
  emptyIcon,
  loading = false,
  selectedId,
  onSelect,
  onItemContextMenu,
  onReparent,
  icon,
}: {
  roots: MediaTreeNode[]
  label: string
  emptyText: string
  /** FontAwesome icon for the empty state. */
  emptyIcon?: string
  /** Show a spinner instead of the empty state while the source is loading. */
  loading?: boolean
  selectedId: string | null
  /** Primary action on a row (toggles the filter in the caller). */
  onSelect: (id: string) => void
  onItemContextMenu?: (node: MediaTreeNode, event: React.MouseEvent) => void
  /** Enables drag-to-nest. newParentId null = move to the top level. */
  onReparent?: (id: string, newParentId: string | null) => void
  /** Leading row icon (tag / folder). */
  icon?: (node: MediaTreeNode) => React.ReactNode
}) {
  const index = useMemo(() => {
    const map = new Map<string, MediaTreeNode>()
    const walk = (node: MediaTreeNode) => {
      map.set(node.id, node)
      node.children.forEach(walk)
    }
    roots.forEach(walk)
    return map
  }, [roots])
  const rootIds = useMemo(() => roots.map((r) => r.id), [roots])

  // The sync loader reads through a ref so its closures always see the latest
  // data without re-creating the tree instance.
  const dataRef = useRef({ index, rootIds })
  dataRef.current = { index, rootIds }

  const nodeOf = (item: ItemInstance<Data>): MediaTreeNode | null => {
    const data = item.getItemData()
    return data && data !== ROOT_ID ? data : null
  }

  const dndEnabled = onReparent !== undefined

  const tree = useTree<Data>({
    rootItemId: ROOT_ID,
    getItemName: (item) => {
      const data = item.getItemData()
      return data && data !== ROOT_ID ? data.label : ''
    },
    isItemFolder: (item) => {
      const data = item.getItemData()
      if (data === ROOT_ID) return true
      return (data?.children.length ?? 0) > 0
    },
    onPrimaryAction: (item) => {
      const node = nodeOf(item)
      if (node) onSelect(node.id)
    },
    dataLoader: {
      getItem: (itemId): Data =>
        itemId === ROOT_ID
          ? ROOT_ID
          : (dataRef.current.index.get(itemId) as MediaTreeNode),
      getChildren: (itemId): string[] =>
        itemId === ROOT_ID
          ? dataRef.current.rootIds
          : (dataRef.current.index.get(itemId)?.children.map((c) => c.id) ??
            []),
    },
    // Drag-to-nest (tags): the new parent is target.item in both drop modes -
    // a tag when dropped into/among a tag's children, the virtual root when
    // dropped among the top-level rows (→ move to root). headless-tree already
    // blocks dropping a tag onto itself or into its own subtree.
    canReorder: true,
    indent: 14,
    reorderAreaPercentage: 0.3,
    createForeignDragObject: (items: ItemInstance<Data>[]) => ({
      format: 'text/plain',
      data: items.map((item) => item.getId()).join('\n'),
    }),
    canDropForeignDragObject: () => false,
    canDragForeignDragObjectOver: () => false,
    canDrag: (items: ItemInstance<Data>[]) =>
      dndEnabled && items.every((item) => nodeOf(item) !== null),
    canDrop: (items: ItemInstance<Data>[], target: DragTarget<Data>) => {
      if (!dndEnabled) return false
      const parent = nodeOf(target.item) // null = top level, always allowed
      if (!parent) return true
      // Never drop a node onto itself or into its own subtree (would create a
      // cycle). Not relying on the library to enforce this.
      return items.every((item) => {
        const dragged = nodeOf(item)
        return dragged !== null && !subtreeContains(dragged, parent.id)
      })
    },
    onDrop: async (items: ItemInstance<Data>[], target: DragTarget<Data>) => {
      if (!onReparent) return
      const parent = nodeOf(target.item)
      const newParentId = parent ? parent.id : null
      for (const item of items) {
        const node = nodeOf(item)
        if (node) await onReparent(node.id, newParentId)
      }
    },
    features: [
      syncDataLoaderFeature,
      selectionFeature,
      hotkeysCoreFeature,
      expandAllFeature,
      ...(dndEnabled ? [dragAndDropFeature] : []),
    ],
  })

  // Re-read the structure whenever the data changes (create/rename/reparent/
  // delete), preserving expansion state.
  const signature = useMemo(() => JSON.stringify(roots), [roots])
  useEffect(() => {
    tree.rebuildTree()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  // Expand everything once on first load so nesting is visible; later rebuilds
  // keep whatever the user has toggled.
  const expandedOnce = useRef(false)
  useEffect(() => {
    if (!expandedOnce.current && rootIds.length > 0) {
      expandedOnce.current = true
      tree.expandAll()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootIds.length])

  // Keep the tree's own selection in sync with the active filter so the
  // highlight matches, even when the filter is changed elsewhere.
  useEffect(() => {
    tree.setSelectedItems(selectedId ? [selectedId] : [])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  const decorate = (data: Data): TreeRowDecor | null => {
    if (data === ROOT_ID) return null
    return {
      icon: icon?.(data) ?? null,
      markers:
        data.count > 0 ? <span className="text-xs">{data.count}</span> : null,
    }
  }

  return (
    <TreeList
      tree={tree}
      label={label}
      emptyText={emptyText}
      emptyIcon={emptyIcon}
      loading={loading}
      rootless
      decorate={decorate}
      onItemContextMenu={
        onItemContextMenu
          ? (item, event) => {
              const node = nodeOf(item)
              if (node) onItemContextMenu(node, event)
            }
          : undefined
      }
    />
  )
}
