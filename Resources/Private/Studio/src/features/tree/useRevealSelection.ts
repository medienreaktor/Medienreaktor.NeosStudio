import { useEffect, useRef, useState } from 'react'
import type { TreeInstance } from '@headless-tree/core'
import { DOCUMENT_NODE_TYPE, fetchAncestors } from '@/api/neos/endpoints/nodes'
import { type NodeAddress, nodeAddressKey } from '@/api/neos/schema'

/**
 * Reveals a node selected outside the tree (e.g. the followed document after
 * a dimension switch): expands the document rootline down to it and marks it
 * selected once it appears, scrolled into view like the classic UI's trees
 * (a deep node in a long outline would otherwise be selected off-screen).
 * Item ids are node aggregate ids (a tree is one subgraph), so the path comes
 * from the ancestors relation; expansion cascades level by level as the
 * async data loader brings the items in, the rerender re-running the effect.
 * A user click needs none of this - it selects directly - but passing the
 * clicked address through here is harmless (everything is already expanded
 * and selected, and the guard stops repeat work per address).
 */
export function useRevealSelection<T>(
  tree: TreeInstance<T>,
  address: NodeAddress | null,
  /** Ancestor filter matching the tree's levels (documents vs. content). */
  nodeTypes: string = DOCUMENT_NODE_TYPE,
) {
  // Stable across renders for the same address, whatever object carries it.
  const key = address === null ? null : nodeAddressKey(address)
  const itemId = address?.nodeAggregateId ?? null
  // Document rootline top-down (item ids), target last; null while unknown.
  const [path, setPath] = useState<string[] | null>(null)
  const revealed = useRef<string | null>(null)

  useEffect(() => {
    if (key === null || itemId === null || revealed.current === key) {
      setPath(null)
      return
    }
    // Selection that originated in the tree (a click) needs no reveal - and
    // no ancestors request.
    const existing = tree.getItems().find((item) => item.getId() === itemId)
    if (existing?.isSelected()) {
      revealed.current = key
      setPath(null)
      return
    }
    let cancelled = false
    fetchAncestors(address!, nodeTypes)
      .then((ancestors) => {
        // Closest-first from the API; the tree wants root-first. The filter
        // already dropped the Neos.Neos:Sites root, so the site node leads.
        if (!cancelled)
          setPath([
            ...ancestors.map((ancestor) => ancestor.nodeAggregateId).reverse(),
            itemId,
          ])
      })
      .catch(() => {
        /* fine - the node stays unrevealed */
      })
    return () => {
      cancelled = true
    }
    // The key stands for the address (a new object for the same node must
    // not restart the reveal).
  }, [key, tree, nodeTypes])

  const items = tree.getItems()

  useEffect(() => {
    if (
      path === null ||
      key === null ||
      itemId === null ||
      revealed.current === key
    )
      return
    const itemsById = new Map(items.map((item) => [item.getId(), item]))
    for (const ancestorId of path.slice(0, -1)) {
      const item = itemsById.get(ancestorId)
      if (item && !item.isExpanded()) item.expand()
    }
    const target = itemsById.get(itemId)
    if (target) {
      revealed.current = key
      tree.setSelectedItems([itemId])
      setPath(null)
      target.scrollTo({ block: 'nearest' }).catch((e: unknown) => {
        console.error('Scrolling the revealed tree item into view failed', {
          address,
          error: e,
        })
      })
    }
  }, [items, path, key, itemId, tree])
}
