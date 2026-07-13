import { useState } from 'react'
import {
  asyncDataLoaderFeature,
  hotkeysCoreFeature,
  selectionFeature,
  type ItemInstance,
} from '@headless-tree/core'
import { useTree } from '@headless-tree/react'
import {
  DOCUMENT_NODE_TYPE,
  fetchChildren,
  fetchNode,
  isExplicitlyHidden,
  nodeLabel,
  type NodeDto,
} from '@/api/nodes'
import { useNodeTypes } from '@/api/nodeTypes'
import type { Site } from '@/api/sites'
import { config } from '@/config'
import {
  NodeContextMenu,
  type NodeMenuAction,
  type NodeMenuTarget,
} from '@/features/editing/NodeContextMenu'
import { nodeDecor } from './nodeDecor'
import { TreeList } from './TreeList'
import { useAutoExpand } from './useAutoExpand'
import { type NodeEdit, useNodeEditRefresh } from './useNodeEditRefresh'
import { usePendingChanges } from './usePendingChanges'
import { useRevealSelection } from './useRevealSelection'

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
export function DocumentTree({
  site,
  workspaceName,
  selectedAddress = null,
  lastEdit = null,
  onSelect,
  onNodeAction,
}: {
  site: Site
  workspaceName: string
  /** Address selected outside the tree (e.g. followed across a dimension switch) - revealed and highlighted. */
  selectedAddress?: string | null
  /** Last reported edit - refreshes those items (labels, children lists). */
  lastEdit?: NodeEdit | null
  onSelect?: (node: NodeDto) => void
  /** A context-menu action (hide/unhide/delete) succeeded for this target. */
  onNodeAction?: (action: NodeMenuAction, target: NodeMenuTarget) => void
}) {
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [menuTarget, setMenuTarget] = useState<NodeMenuTarget | null>(null)
  const { data: nodeTypes } = useNodeTypes()
  const pendingChanges = usePendingChanges(workspaceName)

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
          return children.map((node) => ({
            id: node.address,
            data: node as TreeItemData,
          }))
        } catch (e) {
          setLoadError(String(e))
          return []
        }
      },
    },
    features: [asyncDataLoaderFeature, selectionFeature, hotkeysCoreFeature],
  })

  // The visible root is the site node (level 0), so the site itself plus
  // loadingDepth further document levels load eagerly.
  useAutoExpand(tree, config.nodeTree.loadingDepth)
  useRevealSelection(tree, selectedAddress)

  // After an edit, re-fetch the reported items so labels stay in sync and
  // structural changes (a deleted document) appear.
  useNodeEditRefresh(tree, lastEdit, ROOT_ID)

  // Right-click on a row: the shared hide/unhide/delete menu at the pointer.
  // The site node is the tree's anchor - hiding or deleting the site you are
  // standing in is not offered, same as for tethered documents.
  const openMenu = (
    item: ItemInstance<TreeItemData>,
    event: React.MouseEvent,
  ) => {
    const data = item.getItemData()
    if (data === ROOT_ID || data === null) return
    const parentId = item.getParent()?.getId() ?? null
    setMenuTarget({
      address: data.address,
      parentAddress: parentId === ROOT_ID ? null : parentId,
      hidden: isExplicitlyHidden(data),
      tethered:
        data.classification === 'tethered' || data.address === site.nodeAddress,
      anchor: { x: event.clientX, y: event.clientY, width: 0, height: 0 },
    })
  }

  return (
    <>
      {loadError && (
        <div className="px-2 text-xs text-destructive">{loadError}</div>
      )}
      {actionError && (
        <div className="px-2 text-xs text-destructive">{actionError}</div>
      )}
      <TreeList
        tree={tree}
        label="Document tree"
        emptyText="Loading tree…"
        decorate={(data) =>
          data === ROOT_ID || data === null
            ? null
            : nodeDecor(data, nodeTypes, pendingChanges)
        }
        onItemContextMenu={openMenu}
      />
      <NodeContextMenu
        target={menuTarget}
        entityLabel="document"
        onClose={() => setMenuTarget(null)}
        onDone={(action, target) => {
          setActionError(null)
          onNodeAction?.(action, target)
        }}
        onError={setActionError}
      />
    </>
  )
}
