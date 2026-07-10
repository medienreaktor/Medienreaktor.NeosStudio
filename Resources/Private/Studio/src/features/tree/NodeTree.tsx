import { useRef, useState } from 'react'
import { asyncDataLoaderFeature, hotkeysCoreFeature, selectionFeature } from '@headless-tree/core'
import { useTree } from '@headless-tree/react'
import { DOCUMENT_NODE_TYPE, fetchChildren, fetchNode, nodeLabel, type NodeDto } from '@/api/nodes'
import { fetchSites } from '@/api/sites'

/**
 * Virtual root above the site nodes. Never rendered; its children are the
 * site nodes from /api/sites.
 */
const ROOT_ID = '__sites_root__'

type TreeItemData = NodeDto | typeof ROOT_ID

export function NodeTree({ onInspect }: { onInspect?: (node: NodeDto) => void }) {
  const [loadError, setLoadError] = useState<string | null>(null)
  // Site nodes are fetched individually (unfiltered), so their hasChildren
  // flag counts content children too; remember them and always treat them
  // as expandable entry points.
  const siteAddresses = useRef(new Set<string>())

  const tree = useTree<TreeItemData>({
    rootItemId: ROOT_ID,
    getItemName: (item) => {
      const data = item.getItemData()
      return data === ROOT_ID || data === null ? '…' : nodeLabel(data)
    },
    // Children of tree expansions carry a document-filtered hasChildren
    // ("has document children"), so content-only documents render as leaves.
    isItemFolder: (item) => {
      const data = item.getItemData()
      if (data === ROOT_ID || data === null) return true
      if (siteAddresses.current.has(data.address)) return true
      return data.hasChildren
    },
    onPrimaryAction: (item) => {
      const data = item.getItemData()
      if (data !== ROOT_ID && data !== null && onInspect) onInspect(data)
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
            const { sites } = await fetchSites()
            const siteNodes = await Promise.all(
              sites.flatMap((site) => (site.nodeAddress === null ? [] : [fetchNode(site.nodeAddress)])),
            )
            for (const node of siteNodes) siteAddresses.current.add(node.address)
            return siteNodes.map((node) => ({ id: node.address, data: node as TreeItemData }))
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

  const items = tree.getItems()

  return (
    <div className="tree-panel">
      <h2>Content tree</h2>
      {loadError && <div className="error small">{loadError}</div>}
      <div {...tree.getContainerProps('Content tree')} className="tree">
        {items.length === 0 && !loadError && <div className="muted small">Loading tree…</div>}
        {items.map((item) => (
          <button
            {...item.getProps()}
            key={item.getId()}
            className={[
              'tree-item',
              item.isSelected() ? 'selected' : '',
              item.isFocused() ? 'focused' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{ paddingLeft: `${item.getItemMeta().level * 14 + 6}px` }}
          >
            <span className="tree-arrow">{item.isFolder() ? (item.isExpanded() ? '▾' : '▸') : ''}</span>
            <span className="tree-label">{item.isLoading() ? '…' : item.getItemName()}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
