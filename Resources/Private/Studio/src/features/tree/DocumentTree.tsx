import { useState } from 'react'
import {
  asyncDataLoaderFeature,
  selectionFeature,
  type ItemInstance,
} from '@headless-tree/core'
import { useTree } from '@headless-tree/react'
import { toast } from '@/components/ui/toast'
import {
  DOCUMENT_NODE_TYPE,
  fetchChildren,
  fetchNode,
  isExplicitlyHidden,
  nodeLabel,
  type NodeDto,
} from '@/api/nodes'
import { isNotFound } from '@/api/client'
import { useNodeTypes } from '@/api/nodeTypes'
import type { Site } from '@/api/sites'
import { config } from '@/config'
import { permittedActionsOn } from '@/features/access/permittedActions'
import { translate as t } from '@/lib/i18n'
import { useClipboard } from '@/features/clipboard/clipboardStore'
import { usePresence } from '@/features/collaboration/PresenceContext'
import {
  NodeContextMenu,
  type NodeMenuAction,
  type NodeMenuTarget,
} from '@/features/editing/NodeContextMenu'
import { useNodeDecorators } from './decorators'
import { contextMenuItems } from './menuSelection'
import { nodeDecor } from './nodeDecor'
import { buildTreeDnd } from './treeDnd'
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
  onMoved,
  onCreateNew,
  filterDocuments,
}: {
  site: Site
  workspaceName: string
  /** Address selected outside the tree (e.g. followed across a dimension switch) - revealed and highlighted. */
  selectedAddress?: string | null
  /** Last reported edit - refreshes those items (labels, children lists). */
  lastEdit?: NodeEdit | null
  onSelect?: (node: NodeDto) => void
  /**
   * A context-menu action (hide/unhide/delete) succeeded for these targets -
   * one entry normally, several when the menu acted on a multi-selection.
   */
  onNodeAction?: (action: NodeMenuAction, targets: NodeMenuTarget[]) => void
  /** A drag-and-drop move succeeded; addresses whose children changed. */
  onMoved?: (affectedAddresses: string[]) => void
  /** "Create new…" was picked in the context menu for this target. */
  onCreateNew?: (target: NodeMenuTarget) => void
  /**
   * Drops documents from the tree - access roles that refuse a branch
   * outright. Applied to loaded children only, never to the site node: the
   * tree's own root has to stay, or there is nothing to render at all.
   *
   * Filtering here rather than in the caller is deliberate: children arrive
   * asynchronously per branch, so a row can only be kept out at the moment
   * its parent's list resolves.
   */
  filterDocuments?: (nodes: NodeDto[]) => NodeDto[]
}) {
  // The open context menu: the clicked target plus every selected target the
  // bulk actions apply to (just the clicked one outside multi-select).
  const [menu, setMenu] = useState<{
    target: NodeMenuTarget
    selection: NodeMenuTarget[]
  } | null>(null)
  // Flips once the site node's children have resolved, so the tree can show a
  // spinner while the root loads and a real empty state only afterwards.
  const [rootLoaded, setRootLoaded] = useState(false)
  const { data: nodeTypes } = useNodeTypes()
  const decorators = useNodeDecorators()
  const pendingChanges = usePendingChanges(workspaceName)
  // Collaborators mark the document they are standing on ({} outside a
  // collaborative session - the default context renders nothing).
  const { peers } = usePresence()
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
      return data === ROOT_ID || data === null ? '…' : nodeLabel(data)
    },
    // Every item's hasChildren is fetched document-filtered ("has document
    // children"), so content-only documents render as leaves.
    isItemFolder: (item) => {
      const data = item.getItemData()
      if (data === ROOT_ID || data === null) return true
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
          return await fetchNode(itemId, DOCUMENT_NODE_TYPE)
        } catch (e) {
          // A deleted node (gone after a publish/sync) is expected, not a
          // loading failure - stay quiet; the parent's children list refresh
          // drops the row.
          if (!isNotFound(e)) {
            toast.error(e, {
              title: t('tree.treeLoadFailed', 'Loading the tree failed'),
              id: 'tree-load',
            })
          }
          throw e
        }
      },
      getChildrenWithData: async (itemId) => {
        try {
          if (itemId === ROOT_ID) {
            if (site.nodeAddress === null) {
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
          return (filterDocuments?.(children) ?? children).map((node) => ({
            id: node.address,
            data: node as TreeItemData,
          }))
        } catch (e) {
          // The node was deleted out from under us (e.g. published) - no
          // children to show, and no error worth reporting.
          if (!isNotFound(e)) {
            toast.error(e, {
              title: t('tree.treeLoadFailed', 'Loading the tree failed'),
              id: 'tree-load',
            })
          }
          // Whatever failed, stop showing the loading spinner.
          setRootLoaded(true)
          return []
        }
      },
    },
    features: [asyncDataLoaderFeature, selectionFeature, dnd.feature],
  })

  // The visible root is the site node (level 0), so the site itself plus
  // loadingDepth further document levels load eagerly.
  useAutoExpand(tree, config.nodeTree.loadingDepth)
  useRevealSelection(tree, selectedAddress)

  // After an edit, re-fetch the reported items so labels stay in sync and
  // structural changes (a deleted document) appear.
  useNodeEditRefresh(tree, lastEdit, ROOT_ID)

  // Right-click on a row: the shared hide/unhide/delete menu at the pointer,
  // acting on the whole multi-selection when the clicked row is part of one.
  // The site node is the tree's anchor - hiding or deleting the site you are
  // standing in is not offered, same as for tethered documents.
  const openMenu = (
    item: ItemInstance<TreeItemData>,
    event: React.MouseEvent,
  ) => {
    const anchor = { x: event.clientX, y: event.clientY, width: 0, height: 0 }
    const toTarget = (
      row: ItemInstance<TreeItemData>,
    ): NodeMenuTarget | null => {
      const data = row.getItemData()
      if (data === ROOT_ID || data === null) return null
      const parentId = row.getParent()?.getId() ?? null
      return {
        address: data.address,
        parentAddress: parentId === ROOT_ID ? null : parentId,
        hidden: isExplicitlyHidden(data),
        tethered:
          data.classification === 'tethered' ||
          data.address === site.nodeAddress,
        // Rows outside the role are reachable (they are the path to what is
        // inside it) but nothing on them may change; inside it, the role's
        // capabilities still decide action by action.
        permitted: permittedActionsOn(data, site.nodeName),
        anchor,
      }
    }
    const target = toTarget(item)
    if (target === null) return
    const selection = contextMenuItems(tree, item)
      .map(toTarget)
      .filter((rowTarget): rowTarget is NodeMenuTarget => rowTarget !== null)
    setMenu({ target, selection })
  }

  return (
    <>
      <TreeList
        tree={tree}
        label={t('tree.documentTreeLabel', 'Document tree')}
        loading={!rootLoaded}
        loadingText={t('tree.loadingDocuments', 'Loading documents…')}
        emptyText={t('tree.emptyDocuments', 'This site has no documents yet.')}
        emptyIcon="fa-sitemap"
        decorate={(data) => {
          if (data === ROOT_ID || data === null) return null
          const decor = nodeDecor(
            data,
            nodeTypes,
            pendingChanges,
            peers.filter(
              (peer) => peer.documentAggregateId === data.aggregateId,
            ),
            decorators,
          )
          return data.address === cutAddress
            ? { ...decor, dimmed: true }
            : decor
        }}
        onItemContextMenu={openMenu}
        selectOnContextMenu
      />
      <NodeContextMenu
        target={menu?.target ?? null}
        selection={menu?.selection}
        entityLabel={t('editing.entity.document', 'document')}
        entityLabelPlural={t('editing.entity.documents', 'documents')}
        clipboardKind="document"
        onClose={() => setMenu(null)}
        onDone={(action, targets) => onNodeAction?.(action, targets)}
        onPasted={(affectedAddresses) => onMoved?.(affectedAddresses)}
        onCreateNew={onCreateNew}
      />
    </>
  )
}
