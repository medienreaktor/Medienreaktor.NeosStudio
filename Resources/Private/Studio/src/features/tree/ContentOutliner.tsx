import {
  CONTENT_NODE_TYPES,
  fetchChildren,
  fetchNode,
} from '@/api/neos/endpoints/nodes'
import {
  isRemoved,
  type Node,
  type NodeAddress,
  nodeAddressKey,
  nodeAddressOf,
} from '@/api/neos/schema'
import { config } from '@/config'
import { permittedActionsOn } from '@/features/access/permittedActions'
import { translate as t } from '@/lib/i18n'
import type {
  NodeMenuAction,
  NodeMenuTarget,
} from '@/features/editing/NodeContextMenu'
import { TreeList } from './TreeList'
import type { NodeEdit } from './useNodeEditRefresh'
import { NodeTreeContextMenu, useNodeTree } from './useNodeTree'

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
  document: Node | null
  workspaceName: string | null
  /** Address selected outside the tree (e.g. clicked in the preview) - revealed and highlighted. */
  selectedAddress?: NodeAddress | null
  /** Last inline edit from the preview - refreshes that item's label. */
  lastEdit?: NodeEdit | null
  onSelect?: (node: Node) => void
  /**
   * A context-menu action (hide/unhide/delete) succeeded for these targets -
   * one entry normally, several when the menu acted on a multi-selection.
   */
  onNodeAction?: (action: NodeMenuAction, targets: NodeMenuTarget[]) => void
  /** A drag-and-drop move succeeded; addresses whose children changed. */
  onMoved?: (affectedAddresses: NodeAddress[]) => void
  /** "Create new…" was picked in the context menu for this target. */
  onCreateNew?: (target: NodeMenuTarget) => void
}) {
  // No document is a transient state only (a document is selected
  // automatically on boot and after site/dimension switches) - stay empty.
  if (document === null) return null
  // Key by document: a new document is a new tree (fresh root, fresh
  // expansion state) - remounting is simpler and more predictable than
  // mutating rootItemId on a live tree instance.
  return (
    <OutlinerTree
      key={nodeAddressKey(document)}
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
  document: Node
  workspaceName: string | null
  selectedAddress: NodeAddress | null
  lastEdit: NodeEdit | null
  onSelect?: (node: Node) => void
  onNodeAction?: (action: NodeMenuAction, targets: NodeMenuTarget[]) => void
  onMoved?: (affectedAddresses: NodeAddress[]) => void
  onCreateNew?: (target: NodeMenuTarget) => void
}) {
  // Outlining a DELETED page (selected from the trash): its content inherits
  // the "removed" tag, so every read here has to ask for deleted nodes or the
  // outline comes back empty.
  const deleted = isRemoved(document)
  const nodeTree = useNodeTree({
    // The outline is the document's subgraph - item ids are aggregate ids.
    addressOf: (nodeAggregateId) => ({
      ...nodeAddressOf(document),
      nodeAggregateId,
    }),
    fetchItem: (address) => fetchNode(address, CONTENT_NODE_TYPES, deleted),
    // Re-fetch content-scoped: the passed-in document's hasChildren reflects
    // wherever it was selected from (the document tree, filtered to
    // DOCUMENT_NODE_TYPE), which would starve this root row of the "has
    // content children" flag it needs here.
    fetchRoot: () =>
      fetchNode(nodeAddressOf(document), CONTENT_NODE_TYPES, deleted),
    fetchChildren: (address) =>
      fetchChildren(address, CONTENT_NODE_TYPES, deleted),
    loadErrorTitle: t('tree.outlineLoadFailed', 'Loading the outline failed'),
    loadErrorToastId: 'outliner-load',
    // hasChildren of outliner items comes from content-filtered children
    // responses, so it means "has content children" here.
    folderWhileLoading: true,
    // The visible root is the document (level 0), so the document itself
    // plus loadingDepth further content levels load eagerly (loadingDepth 0
    // = unlimited), like the classic structure tree.
    loadingDepth: config.structureTree.loadingDepth,
    revealNodeTypes: CONTENT_NODE_TYPES,
    selectedAddress,
    lastEdit,
    workspaceName,
    // Collaborators mark the content node they focus.
    peersOn: (node, peers) =>
      peers.filter((peer) => peer.focusedAggregateId === node.nodeAggregateId),
    // The document itself is the outliner's anchor - it belongs to the
    // document tree, so no menu is offered for it here.
    toMenuTarget: (node) =>
      node.nodeAggregateId === document.nodeAggregateId
        ? null
        : {
            tethered: node.classification === 'tethered',
            // Content follows its document: inside a page the role does not
            // cover nothing may change, and inside one it does the
            // capabilities decide.
            permitted: permittedActionsOn(node),
          },
    onSelect,
    onMoved,
  })

  return (
    <>
      <TreeList
        tree={nodeTree.tree}
        label={t('tree.outlinerLabel', 'Content outliner')}
        loading={!nodeTree.rootLoaded}
        loadingText={t('tree.loadingContent', 'Loading content…')}
        emptyText={t('tree.emptyContent', 'No content below this document.')}
        emptyIcon="fa-list-tree"
        decorate={nodeTree.decorate}
        onItemContextMenu={nodeTree.openMenu}
        selectOnContextMenu
      />
      <NodeTreeContextMenu
        nodeTree={nodeTree}
        entityLabel={t('editing.entity.element', 'element')}
        entityLabelPlural={t('editing.entity.elements', 'elements')}
        clipboardKind="content"
        onNodeAction={onNodeAction}
        onMoved={onMoved}
        onCreateNew={onCreateNew}
      />
    </>
  )
}
