import { useEffect, useRef } from 'react'
import type { TreeInstance } from '@headless-tree/core'

/**
 * Expands tree items up to the configured loading depth, mirroring the Neos
 * backend's eager tree loading (Neos.Neos.userInterface.navigateComponent).
 *
 * Items at meta level < depth are expanded, so nodes down to level `depth`
 * become visible (the tree's visible root is level 0). depth 0 means
 * unlimited, per the structureTree setting's contract. Expansion cascades:
 * each level's children load asynchronously, the rerender triggers the next
 * level. Every item is auto-expanded at most once, so user collapses are
 * never fought.
 */
export function useAutoExpand<T>(tree: TreeInstance<T>, depth: number) {
  const autoExpanded = useRef(new Set<string>())
  const items = tree.getItems()

  useEffect(() => {
    for (const item of items) {
      if (depth !== 0 && item.getItemMeta().level >= depth) continue
      const id = item.getId()
      if (!item.isFolder() || item.isExpanded() || autoExpanded.current.has(id))
        continue
      autoExpanded.current.add(id)
      item.expand()
    }
  }, [items, depth])
}
