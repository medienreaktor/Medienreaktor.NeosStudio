import { useEffect, useRef, useState } from 'react'
import type { TreeInstance } from '@headless-tree/core'
import { DOCUMENT_NODE_TYPE, fetchAncestors } from '@/api/nodes'

/**
 * Reveals a node selected outside the tree (e.g. the followed document after
 * a dimension switch): expands the document rootline down to it and marks it
 * selected once it appears. Item ids are node addresses, so the path comes
 * from the ancestors relation; expansion cascades level by level as the
 * async data loader brings the items in, the rerender re-running the effect.
 * A user click needs none of this - it selects directly - but passing the
 * clicked address through here is harmless (everything is already expanded
 * and selected, and the guard stops repeat work per address).
 */
export function useRevealSelection<T>(
  tree: TreeInstance<T>,
  address: string | null,
  /** Ancestor filter matching the tree's levels (documents vs. content). */
  nodeTypes: string = DOCUMENT_NODE_TYPE,
) {
  // Document rootline top-down, target last; null while unknown.
  const [path, setPath] = useState<string[] | null>(null)
  const revealed = useRef<string | null>(null)

  useEffect(() => {
    if (address === null || revealed.current === address) {
      setPath(null)
      return
    }
    // Selection that originated in the tree (a click) needs no reveal - and
    // no ancestors request.
    const existing = tree.getItems().find((item) => item.getId() === address)
    if (existing?.isSelected()) {
      revealed.current = address
      setPath(null)
      return
    }
    let cancelled = false
    fetchAncestors(address, nodeTypes)
      .then((ancestors) => {
        // Closest-first from the API; the tree wants root-first. The filter
        // already dropped the Neos.Neos:Sites root, so the site node leads.
        if (!cancelled)
          setPath([...ancestors.map((a) => a.address).reverse(), address])
      })
      .catch(() => {
        /* fine - the node stays unrevealed */
      })
    return () => {
      cancelled = true
    }
  }, [address, tree, nodeTypes])

  const items = tree.getItems()

  useEffect(() => {
    if (path === null || address === null || revealed.current === address)
      return
    const itemsById = new Map(items.map((item) => [item.getId(), item]))
    for (const ancestorAddress of path.slice(0, -1)) {
      const item = itemsById.get(ancestorAddress)
      if (item && !item.isExpanded()) item.expand()
    }
    const target = itemsById.get(address)
    if (target) {
      revealed.current = address
      tree.setSelectedItems([address])
      setPath(null)
    }
  }, [items, path, address, tree])
}
