import { useState } from 'react'
import { asyncDataLoaderFeature, hotkeysCoreFeature, selectionFeature } from '@headless-tree/core'
import { useTree } from '@headless-tree/react'
import { CONTENT_NODE_TYPES, fetchChildren, fetchNode, type NodeDto } from '@/api/nodes'
import { TreeList } from './TreeList'

/**
 * The content structure below the selected document: collections and content
 * elements, lazily loaded like the document tree.
 */
export function ContentOutliner({
  document,
  onSelect,
}: {
  document: NodeDto | null
  onSelect?: (node: NodeDto) => void
}) {
  return (
    <div className="tree-panel">
      <h2>Content outliner</h2>
      {document === null ? (
        <div className="muted small">Select a document to outline its content.</div>
      ) : (
        // Key by document: a new document is a new tree (fresh root, fresh
        // expansion state) - remounting is simpler and more predictable than
        // mutating rootItemId on a live tree instance.
        <OutlinerTree key={document.address} document={document} onSelect={onSelect} />
      )}
    </div>
  )
}

function OutlinerTree({ document, onSelect }: { document: NodeDto; onSelect?: (node: NodeDto) => void }) {
  const [loadError, setLoadError] = useState<string | null>(null)

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

  return (
    <>
      {loadError && <div className="error small">{loadError}</div>}
      <TreeList tree={tree} label="Content outliner" emptyText="No content below this document." />
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
