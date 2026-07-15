import { useState } from 'react'
import {
  asyncDataLoaderFeature,
  hotkeysCoreFeature,
  selectionFeature,
  type ItemInstance,
} from '@headless-tree/core'
import { useTree } from '@headless-tree/react'
import {
  CONTENT_NODE_TYPES,
  fetchChildren,
  fetchNode,
  isExplicitlyHidden,
  nodeLabel,
  type NodeDto,
} from '@/api/nodes'
import { useNodeTypes } from '@/api/nodeTypes'
import { config } from '@/config'
import {
  NodeContextMenu,
  type NodeMenuAction,
  type NodeMenuTarget,
} from '@/features/editing/NodeContextMenu'
import { nodeDecor } from './nodeDecor'
import { buildTreeDnd } from './treeDnd'
import { TreeList } from './TreeList'
import { useAutoExpand } from './useAutoExpand'
import { type NodeEdit, useNodeEditRefresh } from './useNodeEditRefresh'
import { usePendingChanges } from './usePendingChanges'
import { useRevealSelection } from './useRevealSelection'

export type { NodeEdit } from './useNodeEditRefresh'

/**
 * The content structure below the selected document: collections and content
 * elements, lazily loaded like the document tree.
 */
export function ContentOutliner({
  document,
  workspaceName,
  selectedAddress = null,
  lastEdit = null,
  onSelect,
  onNodeAction,
  onMoved,
}: {
  document: NodeDto | null
  workspaceName: string | null
  /** Address selected outside the tree (e.g. clicked in the preview) - revealed and highlighted. */
  selectedAddress?: string | null
  /** Last inline edit from the preview - refreshes that item's label. */
  lastEdit?: NodeEdit | null
  onSelect?: (node: NodeDto) => void
  /** A context-menu action (hide/unhide/delete) succeeded for this target. */
  onNodeAction?: (action: NodeMenuAction, target: NodeMenuTarget) => void
  /** A drag-and-drop move succeeded; addresses whose children changed. */
  onMoved?: (affectedAddresses: string[]) => void
}) {
  if (document === null) {
    return (
      <div className="px-2 text-xs text-muted-foreground">
        Select a document to outline its content.
      </div>
    )
  }
  // Key by document: a new document is a new tree (fresh root, fresh
  // expansion state) - remounting is simpler and more predictable than
  // mutating rootItemId on a live tree instance.
  return (
    <OutlinerTree
      key={document.address}
      document={document}
      workspaceName={workspaceName}
      selectedAddress={selectedAddress}
      lastEdit={lastEdit}
      onSelect={onSelect}
      onNodeAction={onNodeAction}
      onMoved={onMoved}
    />
  )
}

/**
 * Virtual root above the document. Never rendered; its single child is the
 * document itself, so the document appears as the outliner's visible root
 * (selectable, but without a context menu - it belongs to the document tree).
 */
const ROOT_ID = '__outliner_root__'

type TreeItemData = NodeDto | typeof ROOT_ID | null

function OutlinerTree({
  document,
  workspaceName,
  selectedAddress,
  lastEdit,
  onSelect,
  onNodeAction,
  onMoved,
}: {
  document: NodeDto
  workspaceName: string | null
  selectedAddress: string | null
  lastEdit: NodeEdit | null
  onSelect?: (node: NodeDto) => void
  onNodeAction?: (action: NodeMenuAction, target: NodeMenuTarget) => void
  onMoved?: (affectedAddresses: string[]) => void
}) {
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [menuTarget, setMenuTarget] = useState<NodeMenuTarget | null>(null)
  const { data: nodeTypes } = useNodeTypes()
  const pendingChanges = usePendingChanges(workspaceName)

  const dnd = buildTreeDnd<TreeItemData>({
    getNode: (data) => (data === ROOT_ID || data === null ? null : data),
    onMoved: (addresses) => onMoved?.(addresses),
    onError: setActionError,
  })

  const tree = useTree<TreeItemData>({
    ...dnd.config,
    rootItemId: ROOT_ID,
    getItemName: (item) => {
      const data = item.getItemData()
      if (data === ROOT_ID) return '…'
      return data === null ? '…' : nodeLabel(data)
    },
    // hasChildren of outliner items comes from content-filtered children
    // responses, so it means "has content children" here.
    isItemFolder: (item) => {
      const data = item.getItemData()
      if (data === ROOT_ID) return true
      return data?.hasChildren ?? true
    },
    onPrimaryAction: (item) => {
      const data = item.getItemData()
      if (data !== ROOT_ID && data !== null && onSelect) onSelect(data)
    },
    dataLoader: {
      getItem: async (itemId): Promise<TreeItemData> => {
        if (itemId === ROOT_ID) return ROOT_ID
        try {
          return await fetchNode(itemId, CONTENT_NODE_TYPES)
        } catch (e) {
          setLoadError(String(e))
          throw e
        }
      },
      getChildrenWithData: async (itemId) => {
        if (itemId === ROOT_ID) {
          // Re-fetch content-scoped: the passed-in document's hasChildren
          // reflects wherever it was selected from (the document tree,
          // filtered to DOCUMENT_NODE_TYPE), which would starve this root
          // row of the "has content children" flag it needs here.
          try {
            const contentDocument = await fetchNode(
              document.address,
              CONTENT_NODE_TYPES,
            )
            return [
              {
                id: contentDocument.address,
                data: contentDocument as TreeItemData,
              },
            ]
          } catch (e) {
            setLoadError(String(e))
            return []
          }
        }
        try {
          const children = await fetchChildren(itemId, CONTENT_NODE_TYPES)
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
    features: [
      asyncDataLoaderFeature,
      selectionFeature,
      hotkeysCoreFeature,
      dnd.feature,
    ],
  })

  // The visible root is the document (level 0), so the document itself plus
  // loadingDepth further content levels load eagerly (loadingDepth 0 =
  // unlimited), like the classic structure tree.
  useAutoExpand(tree, config.structureTree.loadingDepth)
  // Selection from outside (preview clicks): expand the content rootline
  // down to the node and highlight it.
  useRevealSelection(tree, selectedAddress, CONTENT_NODE_TYPES)

  // After an edit, re-fetch the affected items so labels stay in sync and
  // structural edits (a node created in a collection) appear. The queries
  // were invalidated by the save; unchanged items resolve from the cache.
  useNodeEditRefresh(tree, lastEdit, ROOT_ID)

  // Right-click on a row: the shared hide/unhide/delete menu at the pointer.
  // The document itself is the outliner's anchor - it belongs to the
  // document tree, so no menu is offered for it here.
  const openMenu = (
    item: ItemInstance<TreeItemData>,
    event: React.MouseEvent,
  ) => {
    const data = item.getItemData()
    if (!data || data === ROOT_ID || data.address === document.address) return
    setMenuTarget({
      address: data.address,
      parentAddress: item.getParent()?.getId() ?? null,
      hidden: isExplicitlyHidden(data),
      tethered: data.classification === 'tethered',
      anchor: { x: event.clientX, y: event.clientY, width: 0, height: 0 },
    })
  }

  return (
    <>
      {loadError && <div className="text-xs text-destructive">{loadError}</div>}
      {actionError && (
        <div className="text-xs text-destructive">{actionError}</div>
      )}
      <TreeList
        tree={tree}
        label="Content outliner"
        emptyText="No content below this document."
        decorate={(data) =>
          data === null || data === ROOT_ID
            ? null
            : nodeDecor(data, nodeTypes, pendingChanges)
        }
        onItemContextMenu={openMenu}
      />
      <NodeContextMenu
        target={menuTarget}
        entityLabel="element"
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

