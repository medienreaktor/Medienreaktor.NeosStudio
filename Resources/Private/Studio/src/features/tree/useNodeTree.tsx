import { useState } from 'react'
import {
  type AsyncDataLoaderDataRef,
  asyncDataLoaderFeature,
  type ItemInstance,
  selectionFeature,
  type TreeInstance,
} from '@headless-tree/core'
import { useTree } from '@headless-tree/react'
import { isNotFound } from '@/api/http/errors'
import { useNodeTypes } from '@/api/neos/endpoints/nodeTypes'
import {
  type Node,
  type NodeAddress,
  nodeAddressKey,
  nodeAddressOf,
} from '@/api/neos/schema'
import { toast } from '@/components/ui/toast'
import { useClipboard } from '@/features/clipboard/clipboardStore'
import {
  type PresencePeer,
  usePresence,
} from '@/features/collaboration/PresenceContext'
import {
  NodeContextMenu,
  type NodeMenuAction,
  type NodeMenuTarget,
} from '@/features/editing/NodeContextMenu'
import { useNodeDecorators } from './decorators'
import { contextMenuItems } from './menuSelection'
import { nodeDecor, type TreeRowDecor } from './nodeDecor'
import { buildTreeDnd } from './treeDnd'
import { useAutoExpand } from './useAutoExpand'
import { type NodeEdit, useNodeEditRefresh } from './useNodeEditRefresh'
import { usePendingChanges } from './usePendingChanges'
import { useRevealSelection } from './useRevealSelection'

/**
 * Virtual root above the tree's visible root. Never rendered; its single
 * child is the visible root (the site node, the outlined document).
 */
export const NODE_TREE_ROOT = '__node_tree_root__'

/**
 * Item data of a node that could not be read (deleted after a publish or
 * sync, or a failed request). getItem resolves to it instead of throwing:
 * headless-tree has no error path for item loads - a rejected getItem leaves
 * the row a skeleton forever and the rejection unhandled. The row renders as
 * an empty leaf until the parent's refreshed children list drops it.
 */
export const MISSING_NODE = '__node_tree_missing__'

/**
 * What a node tree's items carry: a node, one of the placeholders above, or
 * null while headless-tree is still loading the item.
 */
export type NodeTreeItem =
  Node | typeof NODE_TREE_ROOT | typeof MISSING_NODE | null

/** The node behind an item, null for the placeholders and loading rows. */
export function nodeOfItem(data: NodeTreeItem): Node | null {
  return data === null || data === NODE_TREE_ROOT || data === MISSING_NODE
    ? null
    : data
}

/**
 * The machinery the document tree and the content outliner share: a lazily
 * loaded headless-tree over one subgraph (item ids are aggregate ids) with a
 * virtual root, drag-and-drop moves, reveal-on-select, refresh after edits,
 * row decorations (type icon, dirty markers, presence, cut dimming) and the
 * node context menu on right-click. What differs between the two - what is
 * loaded, which rows a menu is offered for, the labels - comes in as
 * options.
 */
export function useNodeTree({
  addressOf,
  fetchItem,
  fetchRoot,
  fetchChildren,
  loadErrorTitle,
  loadErrorToastId,
  folderWhileLoading,
  loadingDepth,
  revealNodeTypes,
  selectedAddress,
  lastEdit,
  workspaceName,
  peersOn,
  toMenuTarget,
  onSelect,
  onMoved,
}: {
  /** The address of an item in the tree's subgraph. */
  addressOf: (nodeAggregateId: string) => NodeAddress
  /** Reads one item (a re-read after an edit, or one not yet seeded). */
  fetchItem: (address: NodeAddress) => Promise<Node>
  /** Reads the visible root; null when there is none (an empty site). */
  fetchRoot: () => Promise<Node | null>
  /** Reads an item's children - already filtered to what the tree shows. */
  fetchChildren: (address: NodeAddress) => Promise<Node[]>
  loadErrorTitle: string
  /** Toast id, so failing loads of many rows raise one toast. */
  loadErrorToastId: string
  /**
   * Whether a row whose hasChildren is unknown shows a folder caret - for
   * trees whose children are commonly not counted up front.
   */
  folderWhileLoading: boolean
  /** Levels below the visible root loaded eagerly (see useAutoExpand). */
  loadingDepth: number
  /** Node type filter of the rootline walk revealing a selection. */
  revealNodeTypes?: string
  selectedAddress: NodeAddress | null
  lastEdit: NodeEdit | null
  workspaceName: string | null
  /** The collaborators to mark on this node's row. */
  peersOn: (node: Node, peers: PresencePeer[]) => PresencePeer[]
  /**
   * The context-menu target for a row, without anchor and addresses (added
   * here); null for rows without a menu (the tree's anchor).
   */
  toMenuTarget: (
    node: Node,
  ) => Pick<NodeMenuTarget, 'tethered' | 'permitted'> | null
  onSelect?: (node: Node) => void
  /** A drag-and-drop move succeeded; addresses whose children changed. */
  onMoved?: (affectedAddresses: NodeAddress[]) => void
}) {
  // The open context menu: the clicked target plus every selected target the
  // bulk actions apply to (just the clicked one outside multi-select).
  const [menu, setMenu] = useState<{
    target: NodeMenuTarget
    selection: NodeMenuTarget[]
  } | null>(null)
  // Flips once the visible root has resolved, so the tree shows a spinner
  // while it loads and a real empty state only afterwards.
  const [rootLoaded, setRootLoaded] = useState(false)
  const { data: nodeTypes } = useNodeTypes()
  const decorators = useNodeDecorators()
  const pendingChanges = usePendingChanges(workspaceName)
  // Collaborators mark the nodes they are on (empty outside a collaborative
  // session - the default context renders nothing).
  const { peers } = usePresence()
  // The active cut entry's rows render dimmed - the nodes are "in transit".
  const clipboard = useClipboard()
  const cutKeys = new Set(
    clipboard.entries
      .find((entry) => entry.id === clipboard.activeId && entry.mode === 'cut')
      ?.nodes.map((node) => nodeAddressKey(node.address)),
  )

  const reportLoadError = (e: unknown) => {
    // A deleted node (gone after a publish/sync) is expected, not a loading
    // failure - stay quiet.
    if (!isNotFound(e))
      toast.error(e, { title: loadErrorTitle, id: loadErrorToastId })
  }

  const dnd = buildTreeDnd<NodeTreeItem>({
    getNode: nodeOfItem,
    onMoved: (addresses) => onMoved?.(addresses),
  })

  const tree: TreeInstance<NodeTreeItem> = useTree<NodeTreeItem>({
    ...dnd.config,
    rootItemId: NODE_TREE_ROOT,
    getItemName: (item) => {
      const node = nodeOfItem(item.getItemData())
      return node === null ? '…' : node.label || node.nodeAggregateId
    },
    isItemFolder: (item) => {
      const data = item.getItemData()
      if (data === NODE_TREE_ROOT) return true
      if (data === MISSING_NODE) return false
      return data?.hasChildren ?? folderWhileLoading
    },
    onPrimaryAction: (item) => {
      const node = nodeOfItem(item.getItemData())
      if (node !== null) onSelect?.(node)
    },
    dataLoader: {
      getItem: async (itemId): Promise<NodeTreeItem> => {
        if (itemId === NODE_TREE_ROOT) return NODE_TREE_ROOT
        try {
          return await fetchItem(addressOf(itemId))
        } catch (e) {
          reportLoadError(e)
          // Never reject (see MISSING_NODE): resolve to the placeholder and
          // have the parents re-read their children, which drops the row.
          setTimeout(() => refreshParentsOf(itemId))
          return MISSING_NODE
        }
      },
      getChildrenWithData: async (itemId) => {
        if (itemId === NODE_TREE_ROOT) {
          try {
            const root = await fetchRoot()
            return root === null
              ? []
              : [{ id: root.nodeAggregateId, data: root as NodeTreeItem }]
          } catch (e) {
            reportLoadError(e)
            return []
          } finally {
            // Whatever happened, stop showing the loading spinner.
            setRootLoaded(true)
          }
        }
        try {
          const children = await fetchChildren(addressOf(itemId))
          return children.map((node) => ({
            id: node.nodeAggregateId,
            data: node as NodeTreeItem,
          }))
        } catch (e) {
          // The node was deleted out from under us (e.g. published) - no
          // children to show, and no error worth reporting.
          reportLoadError(e)
          return []
        }
      },
    },
    // Rows still loading carry null (headless-tree's default, made explicit
    // so it is part of the item type).
    createLoadingItemData: () => null,
    features: [asyncDataLoaderFeature, selectionFeature, dnd.feature],
  })

  /** Re-read the children lists listing this item (see getItem). */
  const refreshParentsOf = (itemId: string) => {
    const childrenIds =
      tree.getDataRef<AsyncDataLoaderDataRef>().current.childrenIds ?? {}
    for (const [parentId, ids] of Object.entries(childrenIds)) {
      if (ids.includes(itemId))
        void tree.getItemInstance(parentId)?.invalidateChildrenIds(true)
    }
  }

  // The visible root is level 0, so it plus loadingDepth further levels load
  // eagerly.
  useAutoExpand(tree, loadingDepth)
  // Selection from outside (preview clicks, followed links): expand the
  // rootline down to the node and highlight it.
  useRevealSelection(tree, selectedAddress, revealNodeTypes)
  // After an edit, re-read the affected items so labels stay in sync and
  // structural changes appear.
  useNodeEditRefresh(tree, lastEdit, NODE_TREE_ROOT)

  const decorate = (data: NodeTreeItem): TreeRowDecor | null => {
    const node = nodeOfItem(data)
    if (node === null) return null
    const decor = nodeDecor(
      node,
      nodeTypes,
      pendingChanges,
      peersOn(node, peers),
      decorators,
    )
    return cutKeys.has(nodeAddressKey(node))
      ? { ...decor, dimmed: true }
      : decor
  }

  // Right-click on a row: the shared hide/unhide/delete menu at the pointer,
  // acting on the whole multi-selection when the clicked row is part of one.
  const openMenu = (
    item: ItemInstance<NodeTreeItem>,
    event: React.MouseEvent,
  ) => {
    const anchor = { x: event.clientX, y: event.clientY, width: 0, height: 0 }
    const toTarget = (
      row: ItemInstance<NodeTreeItem>,
    ): NodeMenuTarget | null => {
      const node = nodeOfItem(row.getItemData())
      if (node === null) return null
      const specific = toMenuTarget(node)
      if (specific === null) return null
      const parentId = row.getParent()?.getId() ?? null
      return {
        address: nodeAddressOf(node),
        parentAddress:
          parentId === null || parentId === NODE_TREE_ROOT
            ? null
            : addressOf(parentId),
        hidden: node.isHidden,
        ...specific,
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

  return {
    tree,
    rootLoaded,
    decorate,
    openMenu,
    menu,
    closeMenu: () => setMenu(null),
  }
}

/**
 * The node context menu of a tree from {@link useNodeTree}, wired to its
 * open menu.
 */
export function NodeTreeContextMenu({
  nodeTree,
  entityLabel,
  entityLabelPlural,
  clipboardKind,
  onNodeAction,
  onMoved,
  onCreateNew,
}: {
  nodeTree: Pick<ReturnType<typeof useNodeTree>, 'menu' | 'closeMenu'>
  entityLabel: string
  entityLabelPlural: string
  clipboardKind: 'document' | 'content'
  onNodeAction?: (action: NodeMenuAction, targets: NodeMenuTarget[]) => void
  onMoved?: (affectedAddresses: NodeAddress[]) => void
  onCreateNew?: (target: NodeMenuTarget) => void
}) {
  return (
    <NodeContextMenu
      target={nodeTree.menu?.target ?? null}
      selection={nodeTree.menu?.selection}
      entityLabel={entityLabel}
      entityLabelPlural={entityLabelPlural}
      clipboardKind={clipboardKind}
      onClose={nodeTree.closeMenu}
      onDone={(action, targets) => onNodeAction?.(action, targets)}
      onPasted={(affectedAddresses) => onMoved?.(affectedAddresses)}
      onCreateNew={onCreateNew}
    />
  )
}
