import { useState } from 'react'
import { asyncDataLoaderFeature, hotkeysCoreFeature, selectionFeature } from '@headless-tree/core'
import { useTree } from '@headless-tree/react'
import { DOCUMENT_NODE_TYPE, fetchChildren, fetchNode, nodeLabel, type NodeDto } from '@/api/nodes'
import type { Site } from '@/api/sites'
import { TreeList } from './TreeList'

/**
 * Virtual root above the site node. Never rendered; its single child is the
 * active site's node, so the site appears as the tree's visible root.
 */
const ROOT_ID = '__site_root__'

type TreeItemData = NodeDto | typeof ROOT_ID

/**
 * Document tree of one site. Remount per site (key by the site's node
 * address) so a site switch starts with fresh expansion state.
 */
export function DocumentTree({ site, onSelect }: { site: Site; onSelect?: (node: NodeDto) => void }) {
  const [loadError, setLoadError] = useState<string | null>(null)

  const tree = useTree<TreeItemData>({
    rootItemId: ROOT_ID,
    getItemName: (item) => {
      const data = item.getItemData()
      return data === ROOT_ID || data === null ? '…' : nodeLabel(data)
    },
    // Children of tree expansions carry a document-filtered hasChildren
    // ("has document children"), so content-only documents render as leaves.
    // The site node's flag comes from an unfiltered single-node fetch (it
    // counts content children too), so it is always treated as expandable.
    isItemFolder: (item) => {
      const data = item.getItemData()
      if (data === ROOT_ID || data === null) return true
      if (data.address === site.nodeAddress) return true
      return data.hasChildren
    },
    onPrimaryAction: (item) => {
      const data = item.getItemData()
      if (data !== ROOT_ID && data !== null && onSelect) onSelect(data)
    },
    dataLoader: {
      getItem: async (itemId): Promise<TreeItemData> => {
        if (itemId === ROOT_ID) return ROOT_ID
        try {
          return await fetchNode(itemId)
        } catch (e) {
          setLoadError(String(e))
          throw e
        }
      },
      getChildrenWithData: async (itemId) => {
        try {
          if (itemId === ROOT_ID) {
            if (site.nodeAddress === null) return []
            const siteNode = await fetchNode(site.nodeAddress)
            return [{ id: siteNode.address, data: siteNode as TreeItemData }]
          }
          const children = await fetchChildren(itemId, DOCUMENT_NODE_TYPE)
          return children.map((node) => ({ id: node.address, data: node as TreeItemData }))
        } catch (e) {
          setLoadError(String(e))
          return []
        }
      },
    },
    features: [asyncDataLoaderFeature, selectionFeature, hotkeysCoreFeature],
  })

  return (
    <div className="tree-panel">
      <h2>Document tree</h2>
      {loadError && <div className="error small">{loadError}</div>}
      <TreeList tree={tree} label="Document tree" emptyText="Loading tree…" />
    </div>
  )
}
