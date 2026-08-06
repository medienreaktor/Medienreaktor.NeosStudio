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
    const childrenIds =
      tree.getDataRef<AsyncDataLoaderDataRef>().current.childrenIds ?? {}
    for (const address of lastEdit.addresses) {
      // A subtree-tag change (hiding/unhiding via the "hidden" property)
      // rewrites the inherited tags of the ENTIRE subtree, not just the node
      // and its direct children - so levels 2+ would otherwise keep their
      // stale cached tags. Re-fetch the children list of the edited node and
      // of every already-loaded descendant that has one: each parent's
      // getChildrenWithData re-seeds its children with fresh data and fires a
      // loading state update that re-renders that level, cascading down to the
      // leaves.
      //
      // Snapshot the parent list BEFORE invalidating anything: a non-optimistic
      // invalidateChildrenIds would delete childrenIds[itemId] synchronously
      // (before its first await), so walking the map after the edited node's
      // own invalidation would find its entry already gone and stop at level 1
      // - the "only the top two levels update" bug. Optimistic invalidation
      // keeps the entries, but the snapshot stays cheap insurance.
      const parents = loadedParentsInSubtree(address, childrenIds)
      const item = tree.getItemInstance(address)
      // The node's own data (label, tags) - its parent isn't in `parents`, so
      // refresh it directly. getItemInstance also resolves the tree root, so
      // edits reported for the root still refresh its direct children below.
      // Optimistic (like the wildcard path above): the row keeps showing its
      // stale data until the refetch lands, instead of flashing to a skeleton
      // whose null data also makes leaves grow a folder caret for a moment.
      void item?.invalidateItemData(true)
      for (const parentId of parents) {
        void tree.getItemInstance(parentId)?.invalidateChildrenIds(true)
      }
    }
  }, [lastEdit, tree, rootId])
}

/**
 * `rootId` plus every already-loaded descendant of it that has a loaded
 * children list, walked from the data loader's cached children map (so it
 * covers collapsed branches too, not just the expanded rows tree.getItems()
 * would return). Re-fetching each one's children list refreshes the data of
 * the level directly below it, so refreshing all of them cascades fresh data
 * to every loaded level. Reads the map without mutating it - the caller must
 * capture the result before invalidating, since invalidation deletes entries.
 */
function loadedParentsInSubtree(
  rootId: string,
  childrenIds: Record<string, string[]>,
): string[] {
  const result: string[] = []
  const stack = [rootId]
  while (stack.length > 0) {
    const id = stack.pop() as string
    const children = childrenIds[id]
    if (children) {
      result.push(id)
      stack.push(...children)
    }
  }
  return result
}
