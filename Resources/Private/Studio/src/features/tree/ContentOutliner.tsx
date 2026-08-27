import { useState } from 'react'
import {
  asyncDataLoaderFeature,
  selectionFeature,
  type ItemInstance,
} from '@headless-tree/core'
import { useTree } from '@headless-tree/react'
import { toast } from '@/components/ui/toast'
import {
  CONTENT_NODE_TYPES,
  fetchChildren,
  fetchNode,
  isDeleted,
  isExplicitlyHidden,
  nodeLabel,
  type NodeDto,
} from '@/api/nodes'
import { isNotFound } from '@/api/client'
import { useNodeTypes } from '@/api/nodeTypes'
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
import { Placeholder } from '@/components/ui/placeholder'
import { useNodeDecorators } from './decorators'
import { contextMenuItems } from './menuSelection'
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
  /**
   * A context-menu action (hide/unhide/delete) succeeded for these targets -
   * one entry normally, several when the menu acted on a multi-selection.
   */
  onNodeAction?: (action: NodeMenuAction, targets: NodeMenuTarget[]) => void
  /** A drag-and-drop move succeeded; addresses whose children changed. */
  onMoved?: (affectedAddresses: string[]) => void
  /** "Create new…" was picked in the context menu for this target. */
  onCreateNew?: (target: NodeMenuTarget) => void
}) {
  if (document === null) {
    return (
      <Placeholder
        icon="fa-list-tree"
        title={t(
          'tree.outlinerEmptyDocument',
          'Select a document to outline its content.',
        )}
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
  onNodeAction?: (action: NodeMenuAction, targets: NodeMenuTarget[]) => void
  onMoved?: (affectedAddresses: string[]) => void
  onCreateNew?: (target: NodeMenuTarget) => void
}) {
  // The open context menu: the clicked target plus every selected target the
  // bulk actions apply to (just the clicked one outside multi-select).
  const [menu, setMenu] = useState<{
    target: NodeMenuTarget
    selection: NodeMenuTarget[]
  } | null>(null)
  // Outlining a DELETED page (selected from the trash): its content inherits
  // the "removed" tag, so every read here has to ask for deleted nodes or the
  // outline comes back empty.
  const deleted = isDeleted(document)
  // Flips once the document root has resolved, so the outliner shows a spinner
  // while loading rather than a misleading "no content" state.
  const [rootLoaded, setRootLoaded] = useState(false)
  const { data: nodeTypes } = useNodeTypes()
  const decorators = useNodeDecorators()
  const pendingChanges = usePendingChanges(workspaceName)
  // Collaborators mark the content node they focus (empty outside a
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
          return await fetchNode(itemId, CONTENT_NODE_TYPES, deleted)
        } catch (e) {
          // Deleted node (gone after a publish/sync) - expected, not a failure;
          // the parent's children refresh drops the row.
          if (!isNotFound(e)) {
            toast.error(e, {
              title: t('tree.outlineLoadFailed', 'Loading the outline failed'),
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
              deleted,
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
              title: t('tree.outlineLoadFailed', 'Loading the outline failed'),
              id: 'outliner-load',
            })
            setRootLoaded(true)
            return []
          }
        }
        try {
          const children = await fetchChildren(
            itemId,
            CONTENT_NODE_TYPES,
            deleted,
          )
          return children.map((node) => ({
            id: node.address,
            data: node as TreeItemData,
          }))
        } catch (e) {
          // The document/node was deleted out from under us (e.g. published) -
          // no children to show, and no error worth reporting.
          if (!isNotFound(e)) {
            toast.error(e, {
              title: t('tree.outlineLoadFailed', 'Loading the outline failed'),
              id: 'outliner-load',
            })
          }
          return []
        }
      },
    },
    features: [asyncDataLoaderFeature, selectionFeature, dnd.feature],
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

  // Right-click on a row: the shared hide/unhide/delete menu at the pointer,
  // acting on the whole multi-selection when the clicked row is part of one.
  // The document itself is the outliner's anchor - it belongs to the
  // document tree, so no menu is offered for it here.
  const openMenu = (
    item: ItemInstance<TreeItemData>,
    event: React.MouseEvent,
  ) => {
    const anchor = { x: event.clientX, y: event.clientY, width: 0, height: 0 }
    const toTarget = (
      row: ItemInstance<TreeItemData>,
    ): NodeMenuTarget | null => {
      const data = row.getItemData()
      if (!data || data === ROOT_ID || data.address === document.address)
        return null
      return {
        address: data.address,
        parentAddress: row.getParent()?.getId() ?? null,
        hidden: isExplicitlyHidden(data),
        tethered: data.classification === 'tethered',
        // Content follows its document: inside a page the role does not cover
        // nothing may change, and inside one it does the capabilities decide.
        permitted: permittedActionsOn(data),
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
        label={t('tree.outlinerLabel', 'Content outliner')}
        loading={!rootLoaded}
        loadingText={t('tree.loadingContent', 'Loading content…')}
        emptyText={t('tree.emptyContent', 'No content below this document.')}
        emptyIcon="fa-list-tree"
        decorate={(data) => {
          if (data === null || data === ROOT_ID) return null
          const decor = nodeDecor(
            data,
            nodeTypes,
            pendingChanges,
            peers.filter(
              (peer) => peer.focusedAggregateId === data.aggregateId,
            ),
            decorators,
          )
          return data.address === cutAddress
            ? { ...decor, dimmed: true }
            : decor
        }}
        onItemContextMenu={openMenu}
      />
      <NodeContextMenu
        target={menu?.target ?? null}
        selection={menu?.selection}
        entityLabel={t('editing.entity.element', 'element')}
        entityLabelPlural={t('editing.entity.elements', 'elements')}
        clipboardKind="content"
        onClose={() => setMenu(null)}
        onDone={(action, targets) => onNodeAction?.(action, targets)}
        onPasted={(affectedAddresses) => onMoved?.(affectedAddresses)}
        onCreateNew={onCreateNew}
      />
    </>
  )
}
