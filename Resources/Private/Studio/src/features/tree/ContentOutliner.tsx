import { useEffect, useState } from 'react'
import { asyncDataLoaderFeature, hotkeysCoreFeature, selectionFeature } from '@headless-tree/core'
import { useTree } from '@headless-tree/react'
import { CONTENT_NODE_TYPES, fetchChildren, fetchNode, type NodeDto } from '@/api/nodes'
import { useNodeTypes } from '@/api/nodeTypes'
import { config } from '@/config'
import { nodeDecor } from './nodeDecor'
import { TreeList } from './TreeList'
import { useAutoExpand } from './useAutoExpand'
import { usePendingChanges } from './usePendingChanges'
import { useRevealSelection } from './useRevealSelection'

/**
 * An edit that happened in the preview; token distinguishes repeats. Usually
 * one address; structural edits (a move) touch several nodes at once.
 */
export interface NodeEdit {
  addresses: string[]
  token: number
}

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
}: {
  document: NodeDto | null
  workspaceName: string | null
  /** Address selected outside the tree (e.g. clicked in the preview) - revealed and highlighted. */
  selectedAddress?: string | null
  /** Last inline edit from the preview - refreshes that item's label. */
  lastEdit?: NodeEdit | null
  onSelect?: (node: NodeDto) => void
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
    />
  )
}

function OutlinerTree({
  document,
  workspaceName,
  selectedAddress,
  lastEdit,
  onSelect,
}: {
  document: NodeDto
  workspaceName: string | null
  selectedAddress: string | null
  lastEdit: NodeEdit | null
  onSelect?: (node: NodeDto) => void
}) {
  const [loadError, setLoadError] = useState<string | null>(null)
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

  // After an edit, re-fetch that item so its label (usually derived from the
  // edited text) stays in sync, and its children so structural edits (a node
  // created in the collection) appear. The queries were invalidated by the
  // save; unchanged children resolve from the still-fresh cache.
  useEffect(() => {
    if (lastEdit === null) return
    for (const address of lastEdit.addresses) {
      const item = tree.getItems().find((candidate) => candidate.getId() === address)
      void item?.invalidateItemData()
      void item?.invalidateChildrenIds()
    }
  }, [lastEdit, tree])

  return (
    <>
      {loadError && <div className="text-xs text-destructive">{loadError}</div>}
      <TreeList
        tree={tree}
        label="Content outliner"
        emptyText="No content below this document."
        decorate={(data) => (data === null ? null : nodeDecor(data, nodeTypes, pendingChanges))}
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
