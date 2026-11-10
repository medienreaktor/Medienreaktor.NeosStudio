import { useEffect, useRef } from 'react'
import type { AsyncDataLoaderDataRef, TreeInstance } from '@headless-tree/core'
import { neosKeys } from '@/api/neos/keys'
import type { Node, NodeAddress } from '@/api/neos/schema'
import { queryClient } from '@/app/queryClient'
import { useLatestRef } from '@/hooks/use-latest-ref'

/**
 * An edit that happened elsewhere (preview, inspector, context menu); token
 * distinguishes repeats. Usually one address; structural edits (a move)
 * touch several, and ALL_NODES means the whole workspace content changed.
 */
export interface NodeEdit {
  addresses: (NodeAddress | typeof ALL_NODES)[]
  /**
   * What changed about the nodes at `addresses`. Omitted: anything - their
   * properties, their tags, their type, or their children (a child created,
   * deleted, moved in or out: the reported address is then the parent), so
   * each tree re-reads the node and its children list. 'properties': only
   * properties/references of the nodes themselves - their children lists
   * are known to be untouched and are not re-read. Set it only where that is
   * certain (a remote NodePropertiesWereSet, an inspector save other than a
   * node type change); hiding needs no flag of its own either way, see
   * useNodeEditRefresh.
   */
  kind?: 'properties'
  token: number
}

/**
 * Wildcard address: the workspace's content was rewritten wholesale
 * (publish rebases it, discard resets it) - every tree item is suspect.
 */
export const ALL_NODES = '*'

/**
 * Keeps a lazily loaded node tree in sync with edits made elsewhere. Two
 * caches stand between an edit and a rendered row: the TanStack node queries
 * the tree's reads go through (fetchQuery - no observers, so invalidating
 * them refetches nothing by itself), and headless-tree's own item data and
 * children lists. Both are dealt with here, in that order - the tree's
 * re-reads must not be served the stale query cache - so a caller reporting
 * an edit cannot forget one.
 *
 * The guiding rule is cost: in a large project a tree has loaded far more
 * than it shows (collapsed branches keep their loaded children), and both
 * trees are mounted at all times, so re-reading everything loaded on every
 * edit means hundreds of requests per save. Only what is on screen is
 * re-read - optimistically, the old rows stay until the fresh data arrives -
 * and loaded-but-hidden branches are DROPPED from the data loader instead:
 * headless-tree serves cached children ids and item data as-is once loaded
 * (no staleness of its own), so a dropped branch is the only way to make
 * sure it loads fresh when it is expanded again, and costs nothing until
 * then.
 *
 * - ALL_NODES (publish/discard/rebase, the reload button, a collaborator's
 *   structural change): the tree's workspace node reads are invalidated, the
 *   children lists of the root and of every expanded row are re-read (which
 *   re-seeds the item data of every visible row - no per-row item read), and
 *   every other loaded list and item is dropped.
 * - Addresses: each node the tree has loaded re-reads its own row; unless
 *   the edit is kind 'properties', its children list is re-read too when its
 *   children are rows (expanded and visible), else dropped. Nodes the tree
 *   never loaded (content reported to the document tree) cost nothing.
 * - Subtree tags (hide/unhide, a move into or out of a hidden branch) are
 *   not told by the caller but detected from the data: see the returned
 *   onLoadedItem, which cascades into the children of every node whose
 *   effective tags changed, however the change was loaded.
 *
 * Returns the data loader's onLoadedItem callback, to pass into useTree's
 * config.
 */
export function useNodeEditRefresh<T>({
  tree,
  lastEdit,
  rootId,
  addressOf,
  nodeOf,
}: {
  tree: TreeInstance<T>
  lastEdit: NodeEdit | null
  /** The virtual root (never rendered, its children are the top rows). */
  rootId: string
  /** The address of an item - also tells the tree's subgraph. */
  addressOf: (nodeAggregateId: string) => NodeAddress
  /** The node behind an item's data, null for placeholders. */
  nodeOf: (data: T) => Node | null
}): (itemId: string, data: T) => void {
  // The effective tags (own + inherited) each loaded node was last seen
  // with, to tell when a re-read node's descendants inherited something new.
  const seenTags = useRef(new Map<string, string>())
  // Nodes whose tags changed, cascaded together on the next tick.
  const pendingCascade = useRef(new Set<string>())
  const cascadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The callers pass fresh closures each render; the edit effect must run
  // once per edit, not per render.
  const addressOfRef = useLatestRef(addressOf)
  const nodeOfRef = useLatestRef(nodeOf)

  useEffect(() => {
    if (lastEdit === null) return
    const addressOf = (id: string) => addressOfRef.current(id)
    const scope = { tree, rootId, addressOf, seenTags: seenTags.current }
    if (lastEdit.addresses.includes(ALL_NODES)) {
      // Marking the queries stale is synchronous, so the re-reads below
      // already fetch fresh data. Only the tree's own workspace: every read
      // of this tree lives there, and other workspaces' reads (and their
      // observers) are none of this tree's business.
      const { contentRepositoryId, workspaceName } = addressOf(rootId)
      // cancelRefetch false: the edit is reported after its write, so a
      // refetch already running was started by the writer's own
      // invalidation and reads fresh data - restarting it (once per tree)
      // only doubled the requests.
      void queryClient.invalidateQueries(
        {
          queryKey: neosKeys.nodes.workspace(
            contentRepositoryId,
            workspaceName,
          ),
        },
        { cancelRefetch: false },
      )
      refreshVisible(scope)
      return
    }
    const dataRef = tree.getDataRef<AsyncDataLoaderDataRef>().current
    const parents = visibleParents(tree, rootId)
    for (const address of lastEdit.addresses) {
      if (address === ALL_NODES) continue
      // The node's reads and its children lists (keyed below the node). A
      // refetch the write's own invalidation started is kept, not restarted
      // (see the ALL_NODES case above).
      void queryClient.invalidateQueries(
        { queryKey: neosKeys.nodes.node(address) },
        { cancelRefetch: false },
      )
      // Item ids are aggregate ids: a tree shows one subgraph. An edit of
      // the same node in another one refreshes the row needlessly, harmless.
      const itemId = address.nodeAggregateId
      const hasData = dataRef.itemData?.[itemId] !== undefined
      const hasChildren = dataRef.childrenIds?.[itemId] !== undefined
      // A node this tree never loaded has no row to refresh - reading it now
      // would only fetch it (or fail to: a content node is not in the
      // document tree's filter) for nothing. It reads fresh once it appears.
      if (!hasData && !hasChildren) continue
      // The node's own row (label, icon, hidden state, hasChildren).
      // Optimistic: the row keeps its stale data until the refetch lands,
      // instead of flashing to a skeleton whose null data also makes leaves
      // grow a folder caret for a moment. If its tags changed (hidden or
      // unhidden), onLoadedItem cascades into its children from there. The
      // visible root (site node, outlined document) is an ordinary item in
      // this respect - its children are rows whenever it is expanded.
      if (hasData) void tree.getItemInstance(itemId).invalidateItemData(true)
      // A plain property save leaves the children list alone.
      if (lastEdit.kind === 'properties' || !hasChildren) continue
      if (parents.has(itemId)) {
        // Its children are rows: re-read the list (created, deleted, moved
        // or reordered children), which re-seeds the children's data too.
        void tree.getItemInstance(itemId).invalidateChildrenIds(true)
      } else {
        // Collapsed (or inside a collapsed branch): forget what was loaded
        // below it so the next expand reads it fresh.
        dropSubtree(scope, itemId)
      }
    }
  }, [lastEdit, tree, rootId, addressOfRef])

  // Cancel a cascade still waiting for its tick when the tree goes away.
  useEffect(
    () => () => {
      if (cascadeTimer.current !== null) clearTimeout(cascadeTimer.current)
    },
    [],
  )

  return (itemId, data) => {
    const node = nodeOfRef.current(data)
    if (node === null) return
    // A descendant's inherited tags are the union of its ancestors' tags,
    // so they can only change if the union a node passes on (its own tags
    // plus what it inherits) changed - hiding a node inside an already
    // hidden branch changes nothing below it, and neither does any plain
    // property edit. Comparing that union is what replaces an explicit
    // "this edit hid something" flag: it catches hide/unhide from the
    // inspector, the context menu and the preview, and moves into or out of
    // hidden branches (the moved node is re-seeded by its new parent's
    // list), whichever load brought the change in.
    const tags = [...new Set([...node.tags, ...node.inheritedTags])]
      .sort()
      .join(' ')
    const previous = seenTags.current.get(itemId)
    seenTags.current.set(itemId, tags)
    if (previous === undefined || previous === tags) return
    // Called in the middle of headless-tree's load bookkeeping (before the
    // tree is rebuilt with the loaded list) - cascade on the next tick, with
    // the rebuilt rows, and batch what one list load reports.
    pendingCascade.current.add(itemId)
    cascadeTimer.current ??= setTimeout(() => {
      cascadeTimer.current = null
      const ids = [...pendingCascade.current]
      pendingCascade.current.clear()
      cascadeTags(
        {
          tree,
          rootId,
          addressOf: (id) => addressOfRef.current(id),
          seenTags: seenTags.current,
        },
        ids,
      )
    })
  }
}

interface RefreshScope<T> {
  tree: TreeInstance<T>
  rootId: string
  addressOf: (nodeAggregateId: string) => NodeAddress
  seenTags: Map<string, string>
}

/**
 * The items whose children are rows right now: the virtual root and every
 * expanded item that is itself a row (tree.getItems() walks expanded items
 * only, so an expanded item inside a collapsed branch is not among them).
 */
function visibleParents<T>(tree: TreeInstance<T>, rootId: string): Set<string> {
  const expanded = new Set(tree.getState().expandedItems)
  const result = new Set([rootId])
  for (const item of tree.getItems()) {
    const id = item.getId()
    if (expanded.has(id)) result.add(id)
  }
  return result
}

/**
 * ALL_NODES: re-read the children lists of the root and of every expanded
 * row - every visible row's data comes along with its parent's list, so
 * that is all a fully refreshed screen takes - and drop every other loaded
 * list and item, so collapsed branches read fresh when they are expanded.
 */
function refreshVisible<T>(scope: RefreshScope<T>): void {
  const { tree, rootId, seenTags } = scope
  const dataRef = tree.getDataRef<AsyncDataLoaderDataRef>().current
  const parents = visibleParents(tree, rootId)
  const rows = new Set(tree.getItems().map((item) => item.getId()))
  // Drop first, then re-read: the re-reads only touch visible entries.
  // Deleting a children list makes headless-tree load it on its next
  // access (an expand), not now; deleting an item's data likewise.
  for (const id of Object.keys(dataRef.childrenIds ?? {})) {
    if (!parents.has(id)) delete dataRef.childrenIds[id]
  }
  for (const id of Object.keys(dataRef.itemData ?? {})) {
    if (id === rootId || rows.has(id)) continue
    delete dataRef.itemData[id]
    seenTags.delete(id)
  }
  for (const id of parents) {
    void tree.getItemInstance(id).invalidateChildrenIds(true)
  }
}

/**
 * The nodes in `ids` were re-read with other effective tags than before:
 * their loaded descendants carry stale inherited tags. Where the children
 * are rows, re-read the list - the re-seeded children run through
 * onLoadedItem again, so the cascade continues level by level exactly as
 * far as the tags changed and rows are shown; below a collapsed node, drop
 * the loaded subtree instead.
 */
function cascadeTags<T>(scope: RefreshScope<T>, ids: string[]): void {
  const { tree, rootId, addressOf } = scope
  const childrenIds =
    tree.getDataRef<AsyncDataLoaderDataRef>().current.childrenIds ?? {}
  const parents = visibleParents(tree, rootId)
  const reread: string[] = []
  for (const id of ids) {
    // Nothing loaded below it: its children read fresh when they show up.
    if (childrenIds[id] === undefined) continue
    if (parents.has(id)) reread.push(id)
    else dropSubtree(scope, id)
  }
  if (reread.length === 0) return
  // The children lists' cached reads predate the tag change - only the
  // edited node's own reads were invalidated by whoever reported the edit.
  invalidateNodeReads(addressOf, reread)
  for (const id of reread) {
    void tree.getItemInstance(id).invalidateChildrenIds(true)
  }
}

/**
 * Forget everything loaded below `id` - its children list and, recursively,
 * its descendants' lists and data - plus their cached query reads, so the
 * branch loads fresh on its next expand. `id` itself keeps its data (its
 * row may be on screen, collapsed). Only for branches whose rows are not
 * shown: nothing is re-rendered here.
 */
function dropSubtree<T>(scope: RefreshScope<T>, id: string): void {
  const { tree, addressOf, seenTags } = scope
  const dataRef = tree.getDataRef<AsyncDataLoaderDataRef>().current
  const childrenIds = dataRef.childrenIds ?? {}
  const dropped: string[] = [id]
  const stack = [...(childrenIds[id] ?? [])]
  delete childrenIds[id]
  while (stack.length > 0) {
    const descendant = stack.pop() as string
    dropped.push(descendant)
    stack.push(...(childrenIds[descendant] ?? []))
    delete childrenIds[descendant]
    delete dataRef.itemData?.[descendant]
    seenTags.delete(descendant)
  }
  invalidateNodeReads(addressOf, dropped)
}

/**
 * Invalidate the cached query reads (item, children list, ...) of these
 * nodes in the tree's subgraph, in one pass over the cache. Relies on the
 * node key layout of neosKeys.nodes: ['nodes', contentRepositoryId,
 * workspaceName, dimensionSpacePoint, nodeAggregateId, ...].
 */
function invalidateNodeReads(
  addressOf: (nodeAggregateId: string) => NodeAddress,
  ids: string[],
): void {
  const { contentRepositoryId, workspaceName, dimensionSpacePoint } =
    addressOf('')
  const idSet = new Set(ids)
  void queryClient.invalidateQueries({
    queryKey: neosKeys.nodes.workspace(contentRepositoryId, workspaceName),
    predicate: (query) =>
      query.queryKey[3] === dimensionSpacePoint &&
      idSet.has(query.queryKey[4] as string),
  })
}
