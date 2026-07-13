import { useState } from 'react'
import { asyncDataLoaderFeature, hotkeysCoreFeature, selectionFeature, type ItemInstance } from '@headless-tree/core'
import { useTree } from '@headless-tree/react'
import { CONTENT_NODE_TYPES, fetchChildren, fetchNode, isExplicitlyHidden, type NodeDto } from '@/api/nodes'
import { useNodeTypes } from '@/api/nodeTypes'
import { config } from '@/config'
import { NodeContextMenu, type NodeMenuAction, type NodeMenuTarget } from '@/features/editing/NodeContextMenu'
import { nodeDecor } from './nodeDecor'
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
}) {
  if (document === null) {
    return <div className="px-2 text-xs text-muted-foreground">Select a document to outline its content.</div>
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
    />
  )
}

function OutlinerTree({
  document,
  workspaceName,
  selectedAddress,
  lastEdit,
  onSelect,
  onNodeAction,
}: {
  document: NodeDto
  workspaceName: string | null
  selectedAddress: string | null
  lastEdit: NodeEdit | null
  onSelect?: (node: NodeDto) => void
  onNodeAction?: (action: NodeMenuAction, target: NodeMenuTarget) => void
}) {
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [menuTarget, setMenuTarget] = useState<NodeMenuTarget | null>(null)
  const { data: nodeTypes } = useNodeTypes()
  const pendingChanges = usePendingChanges(workspaceName)

  const tree = useTree<NodeDto | null>({
    rootItemId: document.address,
    getItemName: (item) => {
      const data = item.getItemData()
      return data === null ? '…' : contentLabel(data)
    },
    // hasChildren of outliner items comes from content-filtered children
    // responses, so it means "has content children" here.
    isItemFolder: (item) => item.getItemData()?.hasChildren ?? true,
    onPrimaryAction: (item) => {
      const data = item.getItemData()
      if (data !== null && onSelect) onSelect(data)
    },
    dataLoader: {
      getItem: async (itemId): Promise<NodeDto | null> => {
        if (itemId === document.address) return document
        try {
          return await fetchNode(itemId)
        } catch (e) {
          setLoadError(String(e))
          throw e
        }
      },
      getChildrenWithData: async (itemId) => {
        try {
          const children = await fetchChildren(itemId, CONTENT_NODE_TYPES)
          return children.map((node) => ({ id: node.address, data: node as NodeDto | null }))
        } catch (e) {
          setLoadError(String(e))
          return []
        }
      },
    },
    features: [asyncDataLoaderFeature, selectionFeature, hotkeysCoreFeature],
  })

  // Content levels below the selected document load eagerly like the classic
  // structure tree (loadingDepth 0 = unlimited).
  useAutoExpand(tree, config.structureTree.loadingDepth)
  // Selection from outside (preview clicks): expand the content rootline
  // down to the node and highlight it.
  useRevealSelection(tree, selectedAddress, CONTENT_NODE_TYPES)

  // After an edit, re-fetch the affected items so labels stay in sync and
  // structural edits (a node created in a collection) appear. The queries
  // were invalidated by the save; unchanged items resolve from the cache.
  useNodeEditRefresh(tree, lastEdit, document.address)

  // Right-click on a row: the shared hide/unhide/delete menu at the pointer.
  const openMenu = (item: ItemInstance<NodeDto | null>, event: React.MouseEvent) => {
    const data = item.getItemData()
    if (!data) return
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
      {actionError && <div className="text-xs text-destructive">{actionError}</div>}
      <TreeList
        tree={tree}
        label="Content outliner"
        emptyText="No content below this document."
        decorate={(data) => (data === null ? null : nodeDecor(data, nodeTypes, pendingChanges))}
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

/**
 * Content elements rarely have a title; fall back to their text (tags
 * stripped), node name, or the unqualified node type ("Text", "Image", …).
 */
function contentLabel(node: NodeDto): string {
  const title = node.properties['title']?.value
  if (typeof title === 'string' && title !== '') return title
  const text = node.properties['text']?.value
  if (typeof text === 'string') {
    const stripped = text.replace(/<[^>]*>/g, '').trim()
    if (stripped !== '') return stripped.length > 40 ? `${stripped.slice(0, 40)}…` : stripped
  }
  if (node.name) return node.name
  return node.nodeType.split(':').pop() ?? node.nodeType
}
