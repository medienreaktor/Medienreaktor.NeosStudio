import { useEffect } from 'react'
import type { AsyncDataLoaderDataRef, TreeInstance } from '@headless-tree/core'

/**
 * An edit that happened elsewhere (preview, inspector, context menu); token
 * distinguishes repeats. Usually one address; structural edits (a move)
 * touch several, and ALL_NODES means the whole workspace content changed.
 */
export interface NodeEdit {
  addresses: string[]
  token: number
}

/**
 * Wildcard address: the workspace's content was rewritten wholesale
 * (publish rebases it, discard resets it) - every tree item is suspect.
 */
export const ALL_NODES = '*'

/**
 * Refreshes a tree's items after reported edits. headless-tree caches item
 * data and children lists itself, so invalidating the TanStack queries alone
 * never updates rendered rows - the affected items must be invalidated here.
 */
export function useNodeEditRefresh<T>(
  tree: TreeInstance<T>,
  lastEdit: NodeEdit | null,
  rootId: string,
): void {
  useEffect(() => {
    if (lastEdit === null) return
    if (lastEdit.addresses.includes(ALL_NODES)) {
      // Re-fetch every loaded item and the (never listed) root - not just
      // the currently visible ones. tree.getItems() only walks expanded
      // items, so a collapsed folder's own (previously loaded) descendants
      // would otherwise keep their pre-change data/children forever, since
      // headless-tree serves cached children ids as-is once loaded.
      // Optimistic invalidation keeps the old rows on screen until fresh
      // data arrives instead of flashing every label to a placeholder.
      const loadedIds = Object.keys(
        tree.getDataRef<AsyncDataLoaderDataRef>().current.itemData ?? {},
      )
      const ids = new Set([
        rootId,
        ...loadedIds,
        ...tree.getItems().map((item) => item.getId()),
      ])
      for (const id of ids) {
        const item = tree.getItemInstance(id)
        void item?.invalidateItemData(true)
        void item?.invalidateChildrenIds(true)
      }
      return
    }
    for (const address of lastEdit.addresses) {
      // getItemInstance also resolves the root item, so edits reported for
      // the tree root refresh its direct children.
      const item = tree.getItemInstance(address)
      void item?.invalidateItemData()
      void item?.invalidateChildrenIds()
    }
  }, [lastEdit, tree, rootId])
}
