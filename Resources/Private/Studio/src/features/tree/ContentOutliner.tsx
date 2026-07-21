import { useState } from 'react'
import {
  asyncDataLoaderFeature,
  hotkeysCoreFeature,
  selectionFeature,
  type ItemInstance,
} from '@headless-tree/core'
import { useTree } from '@headless-tree/react'
import { toast } from '@/components/ui/toast'
import {
  CONTENT_NODE_TYPES,
  fetchChildren,
  fetchNode,
  isExplicitlyHidden,
  nodeLabel,
  type NodeDto,
} from '@/api/nodes'
import { isNotFound } from '@/api/client'
import { useNodeTypes } from '@/api/nodeTypes'
import { config } from '@/config'
import { useClipboard } from '@/features/clipboard/clipboardStore'
import {
  NodeContextMenu,
  type NodeMenuAction,
  type NodeMenuTarget,
} from '@/features/editing/NodeContextMenu'
import { Placeholder } from '@/components/ui/placeholder'
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
  onCreateNew,
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
  /** "Create new…" was picked in the context menu for this target. */
  onCreateNew?: (target: NodeMenuTarget) => void
}) {
  if (document === null) {
    return (
      <Placeholder
        icon="fa-list-tree"
        title="Select a document to outline its content."
      />
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
      onCreateNew={onCreateNew}
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
  onCreateNew,
}: {
  document: NodeDto
  workspaceName: string | null
  selectedAddress: string | null
  lastEdit: NodeEdit | null
  onSelect?: (node: NodeDto) => void
  onNodeAction?: (action: NodeMenuAction, target: NodeMenuTarget) => void
  onMoved?: (affectedAddresses: string[]) => void
  onCreateNew?: (target: NodeMenuTarget) => void
}) {
  const [menuTarget, setMenuTarget] = useState<NodeMenuTarget | null>(null)
  // Flips once the document root has resolved, so the outliner shows a spinner
  // while loading rather than a misleading "no content" state.
  const [rootLoaded, setRootLoaded] = useState(false)
  const { data: nodeTypes } = useNodeTypes()
  const pendingChanges = usePendingChanges(workspaceName)
  // The active cut entry's row renders dimmed - the node is "in transit".
  const clipboard = useClipboard()
  const cutAddress =
    clipboard.entries.find(
      (entry) => entry.id === clipboard.activeId && entry.mode === 'cut',
    )?.address ?? null

  const dnd = buildTreeDnd<TreeItemData>({
    getNode: (data) => (data === ROOT_ID || data === null ? null : data),
    onMoved: (addresses) => onMoved?.(addresses),
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
          // Deleted node (gone after a publish/sync) - expected, not a failure;
          // the parent's children refresh drops the row.
          if (!isNotFound(e)) {
            toast.error(e, {
              title: 'Loading the outline failed',
              id: 'outliner-load',
            })
          }
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
            setRootLoaded(true)
            return [
              {
                id: contentDocument.address,
                data: contentDocument as TreeItemData,
              },
            ]
          } catch (e) {
            toast.error(e, {
              title: 'Loading the outline failed',
              id: 'outliner-load',
            })
            setRootLoaded(true)
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
          // The document/node was deleted out from under us (e.g. published) -
          // no children to show, and no error worth reporting.
          if (!isNotFound(e)) {
            toast.error(e, {
              title: 'Loading the outline failed',
              id: 'outliner-load',
            })
          }
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
      <TreeList
        tree={tree}
        label="Content outliner"
        loading={!rootLoaded}
        loadingText="Loading content…"
        emptyText="No content below this document."
        emptyIcon="fa-list-tree"
        decorate={(data) => {
          if (data === null || data === ROOT_ID) return null
          const decor = nodeDecor(data, nodeTypes, pendingChanges)
          return data.address === cutAddress
            ? { ...decor, dimmed: true }
            : decor
        }}
        onItemContextMenu={openMenu}
      />
      <NodeContextMenu
        target={menuTarget}
        entityLabel="element"
        clipboardKind="content"
        onClose={() => setMenuTarget(null)}
        onDone={(action, target) => onNodeAction?.(action, target)}
        onPasted={(affectedAddresses) => onMoved?.(affectedAddresses)}
        onCreateNew={onCreateNew}
      />
    </>
  )
}
