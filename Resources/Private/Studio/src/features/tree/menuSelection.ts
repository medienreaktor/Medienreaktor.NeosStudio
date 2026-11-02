import type { ItemInstance, TreeInstance } from '@headless-tree/core'

/**
 * The rows a context menu opened on `item` should act on: the whole
 * multi-selection when the clicked row is part of it, the clicked row alone
 * otherwise (TreeList re-selects an unselected row on right-click, so the
 * acted-on rows are always the highlighted ones). A selected row whose
 * ancestor is selected too is dropped - the action on the ancestor already
 * covers its subtree, and e.g. deleting both would fail on the second command
 * (the child is already removed with its parent).
 */
export function contextMenuItems<T>(
  tree: TreeInstance<T>,
  item: ItemInstance<T>,
): ItemInstance<T>[] {
  if (!item.isSelected()) return [item]
  const selected = tree.getItems().filter((row) => row.isSelected())
  const selectedIds = new Set(selected.map((row) => row.getId()))
  return selected.filter((row) => {
    for (let parent = row.getParent(); parent; parent = parent.getParent()) {
      if (selectedIds.has(parent.getId())) return false
    }
    return true
  })
}
