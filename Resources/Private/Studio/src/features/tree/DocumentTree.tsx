import {
  DOCUMENT_NODE_TYPE,
  fetchChildren,
  fetchNode,
} from '@/api/neos/endpoints/nodes'
import { siteNodeAddress } from '@/api/neos/endpoints/sites'
import type { Node, NodeAddress, Site } from '@/api/neos/schema'
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

/**
 * Document tree of one site in one workspace and dimension space point (a
 * subgraph - item ids are node aggregate ids). Remount per site (key by the
 * site's node address) so a site switch starts with fresh expansion state.
 */
export function DocumentTree({
  site,
  workspaceName,
  dimensionSpacePoint,
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
  /** The dimension space point the tree shows (JSON). */
  dimensionSpacePoint: string
  /** Address selected outside the tree (e.g. followed across a dimension switch) - revealed and highlighted. */
  selectedAddress?: NodeAddress | null
  /** Last reported edit - refreshes those items (labels, children lists). */
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
  /**
   * Drops documents from the tree - access roles that refuse a branch
   * outright. Applied to loaded children only, never to the site node: the
   * tree's own root has to stay, or there is nothing to render at all.
   *
   * Filtering here rather than in the caller is deliberate: children arrive
   * asynchronously per branch, so a row can only be kept out at the moment
   * its parent's list resolves.
   */
  filterDocuments?: (nodes: Node[]) => Node[]
}) {
  // The site node in the shown subgraph; every other item's address is the
  // same subgraph with the item's aggregate id.
  const siteNode = siteNodeAddress(site, workspaceName, dimensionSpacePoint)
  const nodeTree = useNodeTree({
    addressOf: (nodeAggregateId) => ({
      contentRepositoryId: site.contentRepositoryId,
      workspaceName,
      dimensionSpacePoint,
      nodeAggregateId,
    }),
    fetchItem: (address) => fetchNode(address, DOCUMENT_NODE_TYPE),
    fetchRoot: () =>
      siteNode === null
        ? Promise.resolve(null)
        : fetchNode(siteNode, DOCUMENT_NODE_TYPE),
    fetchChildren: async (address) => {
      const children = await fetchChildren(address, DOCUMENT_NODE_TYPE)
      return filterDocuments?.(children) ?? children
    },
    loadErrorTitle: t('tree.treeLoadFailed', 'Loading the tree failed'),
    loadErrorToastId: 'tree-load',
    // Every item's hasChildren is fetched document-filtered ("has document
    // children"), so content-only documents render as leaves.
    folderWhileLoading: false,
    // The visible root is the site node (level 0), so the site itself plus
    // loadingDepth further document levels load eagerly.
    loadingDepth: config.nodeTree.loadingDepth,
    selectedAddress,
    lastEdit,
    workspaceName,
    // Collaborators mark the document they are standing on.
    peersOn: (node, peers) =>
      peers.filter((peer) => peer.documentAggregateId === node.nodeAggregateId),
    // The site node is the tree's anchor - hiding or deleting the site you
    // are standing in is not offered, same as for tethered documents.
    toMenuTarget: (node) => ({
      tethered:
        node.classification === 'tethered' ||
        node.nodeAggregateId === site.nodeAggregateId,
      // Rows outside the role are reachable (they are the path to what is
      // inside it) but nothing on them may change; inside it, the role's
      // capabilities still decide action by action.
      permitted: permittedActionsOn(node, site.nodeName),
    }),
    onSelect,
    onMoved,
  })

  return (
    <>
      <TreeList
        tree={nodeTree.tree}
        label={t('tree.documentTreeLabel', 'Document tree')}
        loading={!nodeTree.rootLoaded}
        loadingText={t('tree.loadingDocuments', 'Loading documents…')}
        emptyText={t('tree.emptyDocuments', 'This site has no documents yet.')}
        emptyIcon="fa-sitemap"
        decorate={nodeTree.decorate}
        onItemContextMenu={nodeTree.openMenu}
        selectOnContextMenu
      />
      <NodeTreeContextMenu
        nodeTree={nodeTree}
        entityLabel={t('editing.entity.document', 'document')}
        entityLabelPlural={t('editing.entity.documents', 'documents')}
        clipboardKind="document"
        onNodeAction={onNodeAction}
        onMoved={onMoved}
        onCreateNew={onCreateNew}
      />
    </>
  )
}
