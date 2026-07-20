import { useState } from 'react'
import {
  asyncDataLoaderFeature,
  hotkeysCoreFeature,
  selectionFeature,
} from '@headless-tree/core'
import { useTree } from '@headless-tree/react'
import { addressWithAggregateId } from '@/api/nodeAddress'
import {
  DOCUMENT_NODE_TYPE,
  fetchChildren,
  fetchNode,
  nodeLabel,
  type NodeDto,
} from '@/api/nodes'
import { useNodeTypes } from '@/api/nodeTypes'
import { config } from '@/config'
import { Input } from '@/components/ui/input'
import { Placeholder } from '@/components/ui/placeholder'
import { useStudio } from '@/app/StudioContext'
import { nodeDecor } from '@/features/tree/nodeDecor'
import { TreeList } from '@/features/tree/TreeList'
import { useAutoExpand } from '@/features/tree/useAutoExpand'
import { useRevealSelection } from '@/features/tree/useRevealSelection'
import { documentUri, parseDocumentUri } from '../linkValue'
import type { LinkTypeTabProps } from '../registry'

/** Virtual root above the site node, as in the document tree panel. */
const ROOT_ID = '__link_target_root__'

type TreeItemData = NodeDto | typeof ROOT_ID

/**
 * "Link to a document": the site's document tree as a picker. Selecting a
 * document reports node://<aggregateId>; an existing document link is revealed
 * and highlighted. The optional anchor input appends a #fragment, so a link
 * can point at a section within the target page.
 *
 * A read-only sibling of the DocumentTree panel: same data loading, eager
 * expansion and row decor, but no context menus or drag-and-drop - picking is
 * the only interaction.
 */
export function DocumentLinkTab({ href, onChange }: LinkTypeTabProps) {
  const { site } = useStudio()
  const { data: nodeTypes } = useNodeTypes()
  const parsed = href !== null ? parseDocumentUri(href) : null
  // The anchor is owned here (typing must not wait for a picked document);
  // the picked document travels through the href draft.
  const [anchor, setAnchor] = useState(() => parsed?.anchor ?? '')
  // Flips once the site node's children resolve (see DocumentTree).
  const [rootLoaded, setRootLoaded] = useState(false)

  const selectedAddress =
    parsed !== null && site?.nodeAddress
      ? addressWithAggregateId(site.nodeAddress, parsed.aggregateId)
      : null

  const emit = (aggregateId: string | null, anchorText: string) => {
    onChange(
      aggregateId === null ? null : documentUri(aggregateId, anchorText.trim()),
    )
  }

  const tree = useTree<TreeItemData>({
    rootItemId: ROOT_ID,
    getItemName: (item) => {
      const data = item.getItemData()
      return data === ROOT_ID || data === null ? '…' : nodeLabel(data)
    },
    isItemFolder: (item) => {
      const data = item.getItemData()
      if (data === ROOT_ID || data === null) return true
      return data.hasChildren
    },
    onPrimaryAction: (item) => {
      const data = item.getItemData()
      if (data !== ROOT_ID && data !== null) emit(data.aggregateId, anchor)
    },
    dataLoader: {
      getItem: async (itemId): Promise<TreeItemData> => {
        if (itemId === ROOT_ID) return ROOT_ID
        return await fetchNode(itemId, DOCUMENT_NODE_TYPE)
      },
      getChildrenWithData: async (itemId) => {
        try {
          if (itemId === ROOT_ID) {
            if (!site?.nodeAddress) {
              setRootLoaded(true)
              return []
            }
            const siteNode = await fetchNode(
              site.nodeAddress,
              DOCUMENT_NODE_TYPE,
            )
            setRootLoaded(true)
            return [{ id: siteNode.address, data: siteNode as TreeItemData }]
          }
          const children = await fetchChildren(itemId, DOCUMENT_NODE_TYPE)
          return children.map((node) => ({
            id: node.address,
            data: node as TreeItemData,
          }))
        } catch {
          // A vanished node just yields no children - the picker stays usable.
          setRootLoaded(true)
          return []
        }
      },
    },
    features: [asyncDataLoaderFeature, selectionFeature, hotkeysCoreFeature],
  })

  useAutoExpand(tree, config.nodeTree.loadingDepth)
  useRevealSelection(tree, selectedAddress)

  if (!site) {
    return (
      <Placeholder
        icon="fa-sitemap"
        title="No site is active - there is no document tree to pick from."
      />
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-neutral-800 bg-neutral-950 p-1">
        <TreeList
          tree={tree}
          label="Link target document"
          loading={!rootLoaded}
          loadingText="Loading documents…"
          emptyText="This site has no documents yet."
          emptyIcon="fa-sitemap"
          decorate={(data) =>
            data === ROOT_ID || data === null
              ? null
              : nodeDecor(data, nodeTypes, null)
          }
        />
      </div>
      <label className="flex items-center gap-2 text-xs text-neutral-400">
        <span className="shrink-0">Anchor</span>
        <Input
          value={anchor}
          onChange={(event) => {
            setAnchor(event.target.value)
            emit(parsed?.aggregateId ?? null, event.target.value)
          }}
          placeholder="Optional #anchor on the target page"
          className="h-7 text-sm"
        />
      </label>
    </div>
  )
}
