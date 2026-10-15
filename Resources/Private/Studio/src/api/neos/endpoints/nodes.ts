import { skipToken, useQuery } from '@tanstack/react-query'
import { queryClient } from '@/app/queryClient'
import { api, fetchAllPages, unwrap } from '../client'
import { neosKeys } from '../keys'
import type {
  Node,
  NodeAddress,
  NodeReference,
  NodeVariantListing,
  ViewData,
} from '../schema'
import { nodeAddressKey } from '../schema'
import type { operations } from '../schema/openapi'
import { fetchNodeTypes, matchesNodeTypeFilter, nodeTypeMap } from './nodeTypes'

/**
 * Reading nodes (Neos.Api's Nodes tag). A node is addressed by a NodeAddress -
 * any Node is one - and comes back as Neos.Api's Node.
 */

export const DOCUMENT_NODE_TYPE = 'Neos.Neos:Document'

/**
 * The content structure below a document: collections (e.g. "main") are not
 * Neos.Neos:Content subtypes, so both types are needed to outline content.
 */
export const CONTENT_NODE_TYPES =
  'Neos.Neos:Content,Neos.Neos:ContentCollection'

/** The query parameters of getNode (Neos.Api's). */
type NodeQuery = NonNullable<operations['getNode']['parameters']['query']>

/** The query parameters of listNodes (Neos.Api's). */
type NodeListQuery = NonNullable<operations['listNodes']['parameters']['query']>

const NODES = '/cr/{contentRepositoryId}/nodes'
const NODE = '/cr/{contentRepositoryId}/nodes/{nodeAggregateId}'

/** The path parameters of a node operation. */
export function nodePathParams(address: NodeAddress) {
  return {
    contentRepositoryId: address.contentRepositoryId,
    nodeAggregateId: address.nodeAggregateId,
  }
}

/** The subgraph of the address, as the query parameters of a node operation. */
export function subgraphOf(address: NodeAddress) {
  return {
    workspaceName: address.workspaceName,
    dimensionSpacePoint: address.dimensionSpacePoint,
  }
}

/**
 * GET the node at the address, with the given further query parameters (an
 * undefined one leaves the address's out, e.g. dimensionSpacePoint for the
 * default one).
 */
export function getNode(
  address: NodeAddress,
  params: NodeQuery = {},
  signal?: AbortSignal,
): Promise<Node> {
  return unwrap(
    api.GET(NODE, {
      params: {
        path: nodePathParams(address),
        query: { ...subgraphOf(address), ...params },
      },
      signal,
    }),
  )
}

/** Query parameters reading hasChildren (optionally of node types) and removed nodes. */
function hasChildrenParams(nodeTypes?: string, removed = false) {
  return {
    include: 'hasChildren',
    hasChildrenOfNodeType: nodeTypes || undefined,
    includeRemoved: removed || undefined,
  }
}

/**
 * The node with hasChildren - of the node types, if given (a tree passes the
 * filter it lists children with, or hasChildren tells "has any children").
 */
function loadNode(
  address: NodeAddress,
  nodeTypes?: string,
  removed = false,
  signal?: AbortSignal,
): Promise<Node> {
  return getNode(address, hasChildrenParams(nodeTypes, removed), signal)
}

export function useNode(
  address: NodeAddress | null,
  enabled = true,
  /** Read a removed (deleted) node - without this it does not exist for the API. */
  removed = false,
) {
  return useQuery({
    queryKey: neosKeys.nodes.get(address, undefined, removed),
    queryFn:
      enabled && address !== null
        ? ({ signal }) => loadNode(address, undefined, removed, signal)
        : skipToken,
  })
}

/** Imperative variant of useNode for non-hook contexts (e.g. the tree data loader). */
export function fetchNode(
  address: NodeAddress,
  nodeTypes?: string,
  /** Read a removed (deleted) node - without this it does not exist for the API. */
  removed = false,
): Promise<Node> {
  return queryClient.fetchQuery({
    queryKey: neosKeys.nodes.get(address, nodeTypes, removed),
    queryFn: ({ signal }) => loadNode(address, nodeTypes, removed, signal),
  })
}

/**
 * Renders one content element out-of-band: the HTML fragment the page's
 * Fusion produces for this node at the given rendering entry point (the
 * data-__neos-fusion-path attribute of the currently rendered element), via
 * Neos.Api's fusionPathHtml view. Rendering mode "inPlace" keeps the editing
 * metadata attributes in the markup, so the fragment can replace the live
 * element in the preview. Never cached - the point is a fresh render after
 * an edit.
 *
 * An element that fails to render comes back with the error rendered in its
 * place, as in the Neos backend; a 4xx (unknown/stale path, missing node)
 * rejects, and so does a response without HTML - callers fall back to a full
 * reload then.
 */
export async function renderNodeElement(
  address: NodeAddress,
  fusionPath: string,
  signal?: AbortSignal,
): Promise<string> {
  const view: ViewData & { html?: unknown } = await unwrap(
    api.GET('/views/{viewName}', {
      params: {
        path: { viewName: 'fusionPathHtml' },
        query: {
          contentRepositoryId: address.contentRepositoryId,
          nodeAggregateId: address.nodeAggregateId,
          ...subgraphOf(address),
          renderingMode: 'inPlace',
          arguments: { fusionPath },
        },
      },
      signal,
    }),
  )
  const { html } = view
  if (typeof html !== 'string' || html.trim() === '') {
    throw new Error('The element rendered no HTML')
  }
  return html
}

/**
 * A URL path segment (slug) for the node from the given text - or from its
 * title when the text is empty - with the server's language-aware
 * transliteration (ä→ae, ß→ss). Read-only: nothing is written.
 */
export async function generateUriPathSegment(
  address: NodeAddress,
  text: string,
  signal?: AbortSignal,
): Promise<string> {
  const { uriPathSegment } = await unwrap(
    api.GET(`${NODE}/uripathsegment`, {
      params: {
        path: nodePathParams(address),
        query: { ...subgraphOf(address), text: text || undefined },
      },
      signal,
    }),
  )
  return uriPathSegment
}

/**
 * The variants of the node aggregate (data: one node per occupied dimension
 * space point) and every point it is reachable in (meta.coveredDimensionSpacePoints,
 * shine-through included). A point outside them needs a variant first.
 */
export function useNodeVariants(address: NodeAddress | null, enabled = true) {
  return useQuery({
    queryKey: neosKeys.nodes.variants(address),
    queryFn:
      enabled && address !== null
        ? ({ signal }): Promise<NodeVariantListing> =>
            unwrap(
              api.GET(`${NODE}/variants`, {
                params: {
                  path: nodePathParams(address),
                  query: { workspaceName: address.workspaceName },
                },
                signal,
              }),
            )
        : skipToken,
  })
}

/**
 * The node types the content model allows as children of the node, as the
 * classic UI derives them: for a tethered node (an autocreated collection)
 * the constraints of its parent's tethered child node, for any other node its
 * own node type's. Only the parent is needed, but Neos.Api has no include
 * for it alone - the ancestors' first is the parent.
 */
async function loadAllowedChildNodeTypes(
  address: NodeAddress,
  signal?: AbortSignal,
): Promise<string[]> {
  const [node, nodeTypes] = await Promise.all([
    getNode(address, { include: 'ancestors' }, signal),
    fetchNodeTypes(
      address.contentRepositoryId,
      'allowedChildNodeTypes,tetheredChildNodes',
    ),
  ])
  const types = nodeTypeMap(nodeTypes)
  if (node.classification === 'tethered' && node.name !== null) {
    const parent = node.ancestors?.[0]
    const tethered = parent
      ? types
          .get(parent.nodeType)
          ?.tetheredChildNodes?.find((child) => child.name === node.name)
      : undefined
    if (tethered) return tethered.allowedChildNodeTypes
  }
  return types.get(node.nodeType)?.allowedChildNodeTypes ?? []
}

/**
 * The node types allowed below the node (tethered-collection constraints
 * honored), e.g. to validate drop targets. Cached for the session - they
 * follow from the node type model and the node's tethered position.
 */
export function fetchAllowedChildNodeTypes(
  address: NodeAddress,
): Promise<string[]> {
  return queryClient.fetchQuery({
    queryKey: neosKeys.nodes.allowedChildNodeTypes(address),
    queryFn: ({ signal }) => loadAllowedChildNodeTypes(address, signal),
    staleTime: Infinity,
  })
}

/** Hook variant of fetchAllowedChildNodeTypes, sharing its cache entries. */
export function useAllowedChildNodeTypes(address: NodeAddress | null) {
  return useQuery({
    queryKey: neosKeys.nodes.allowedChildNodeTypes(address),
    queryFn:
      address !== null
        ? ({ signal }) => loadAllowedChildNodeTypes(address, signal)
        : skipToken,
    staleTime: Infinity,
  })
}

/**
 * The ancestors, closest first (parent, grandparent, ... up to the site node -
 * the content repository root is not included).
 */
async function loadAncestors(
  address: NodeAddress,
  signal?: AbortSignal,
): Promise<Node[]> {
  const node = await getNode(address, { include: 'ancestors' }, signal)
  return node.ancestors ?? []
}

export function useNodeAncestors(address: NodeAddress | null, enabled = true) {
  return useQuery({
    queryKey: neosKeys.nodes.ancestors(address),
    queryFn:
      enabled && address !== null
        ? ({ signal }) => loadAncestors(address, signal)
        : skipToken,
  })
}

/**
 * Imperative variant of useNodeAncestors, optionally only the ancestors of
 * the given node types (NodeTypeCriteria syntax).
 */
export async function fetchAncestors(
  address: NodeAddress,
  nodeTypes?: string,
): Promise<Node[]> {
  const [ancestors, types] = await Promise.all([
    queryClient.fetchQuery({
      queryKey: neosKeys.nodes.ancestors(address),
      queryFn: ({ signal }) => loadAncestors(address, signal),
    }),
    nodeTypes
      ? fetchNodeTypes(address.contentRepositoryId)
      : Promise.resolve(null),
  ])
  if (types === null || !nodeTypes) return ancestors
  const map = nodeTypeMap(types)
  return ancestors.filter((ancestor) =>
    matchesNodeTypeFilter(map, ancestor.nodeType, nodeTypes),
  )
}

/**
 * The node with its references, each with the referenced node
 * (include=references.node) - where a reference editor reads its value from.
 * Invalidated by the nodes.node(address) prefix after every save.
 */
export function useNodeReferences(address: NodeAddress | null, enabled = true) {
  return useQuery({
    queryKey: neosKeys.nodes.references(address),
    queryFn:
      enabled && address !== null
        ? ({ signal }) =>
            getNode(address, { include: 'references.node' }, signal)
        : skipToken,
  })
}

/** How many ids one filterByNodeAggregateId request takes at most. */
const NODE_IDS_PER_REQUEST = 100

/**
 * The nodes with these aggregate ids in one subgraph (listNodes'
 * filterByNodeAggregateId), up to 100 per request - e.g. the labels of the
 * nodes a diff names. Ids the subgraph lacks or the account may not read are
 * left out. A dimension space point left undefined is the default one.
 */
export async function listNodesById(
  contentRepositoryId: string,
  subgraph: { workspaceName: string; dimensionSpacePoint?: string },
  nodeAggregateIds: string[],
  params: Pick<NodeListQuery, 'include' | 'includeRemoved'> = {},
  signal?: AbortSignal,
): Promise<Node[]> {
  const unique = [...new Set(nodeAggregateIds)]
  const chunks: string[][] = []
  for (let i = 0; i < unique.length; i += NODE_IDS_PER_REQUEST) {
    chunks.push(unique.slice(i, i + NODE_IDS_PER_REQUEST))
  }
  const listings = await Promise.all(
    chunks.map((ids) =>
      unwrap(
        api.GET(NODES, {
          params: {
            path: { contentRepositoryId },
            query: {
              ...subgraph,
              filterByNodeAggregateId: ids.join(','),
              limit: ids.length,
              ...params,
            },
          },
          signal,
        }),
      ),
    ),
  )
  return listings.flatMap((listing) => listing.data)
}

/** The references of a node read with include=references, by name. */
export function nodeReferences(node: Node): Record<string, NodeReference[]> {
  return node.references ?? {}
}

/** The listNodes query of the descendants of a node, with their ancestors. */
function descendantsQuery(
  context: NodeAddress,
  nodeTypes: string,
  params: NodeListQuery,
): NodeListQuery {
  return {
    ...subgraphOf(context),
    filterByHierarchy: {
      type: 'descendantOf',
      nodeAggregateId: context.nodeAggregateId,
    },
    filterByNodeType: nodeTypes || undefined,
    // The ancestors locate a hit: its breadcrumb, its place for access rules.
    include: 'ancestors',
    ...params,
  }
}

/**
 * Fulltext search over the descendants of a node (typically the site), each
 * hit with its ancestors - what reference editors and pickers use for
 * search-as-you-type.
 */
export async function searchNodes(
  context: NodeAddress,
  term: string,
  nodeTypes: string,
  limit = 20,
  signal?: AbortSignal,
): Promise<Node[]> {
  const listing = await unwrap(
    api.GET(NODES, {
      params: {
        path: { contentRepositoryId: context.contentRepositoryId },
        query: descendantsQuery(context, nodeTypes, {
          search: term || undefined,
          limit,
        }),
      },
      signal,
    }),
  )
  return listing.data
}

/**
 * A filterByProperty string literal for the term. The content repository's
 * syntax has no escapes inside a literal, so the quote character is the one
 * the term does not contain (a term with both loses its double quotes), and
 * backslashes - which would swallow the closing quote - are dropped.
 */
function propertyCriteriaLiteral(term: string): string {
  const text = term.replace(/\\/g, '')
  if (!text.includes("'")) return `'${text}'`
  return `"${text.replace(/"/g, '')}"`
}

/**
 * All matching descendants of a node (typically the site), regardless of
 * depth and without pagination, each with its ancestors - the document
 * toolbar's filter. A term matches the title (case-insensitive contains).
 */
export function useFilteredDescendants(
  context: NodeAddress | null,
  title: string,
  nodeTypes: string,
  enabled = true,
) {
  return useQuery({
    queryKey: neosKeys.nodes.descendants(context, { nodeTypes, title }),
    queryFn:
      enabled && context !== null
        ? ({ signal }) =>
            fetchAllPages((page) =>
              unwrap(
                api.GET(NODES, {
                  params: {
                    path: { contentRepositoryId: context.contentRepositoryId },
                    query: descendantsQuery(context, nodeTypes, {
                      filterByProperty:
                        title !== ''
                          ? `title *=~ ${propertyCriteriaLiteral(title)}`
                          : undefined,
                      ...page,
                    }),
                  },
                  signal,
                }),
              ),
            )
        : skipToken,
  })
}

/**
 * Parent aggregate id per child node, observed while reading children - keyed
 * by the child's full address (content repository, workspace, dimension space
 * point, aggregate id). In Neos 9 the hierarchy is a property of the
 * subgraph: a node moved in a workspace, or moved in one dimension only, has
 * a different parent there than in live or in its other variants, so one map
 * across subgraphs would answer with whichever was read last. Structural
 * moves refresh the children list that fills it, which overwrites the entry.
 *
 * Kept outside the query cache on purpose: this is a fact about the content
 * graph, not a cached response, and consumers need it synchronously during
 * render (row decoration walks a node's ancestry).
 */
const observedNodeParents = new Map<string, string>()

/**
 * The ancestry of a node in its subgraph as far as it has been observed, node
 * first and root last - the shape ancestor-relative rules are evaluated
 * against. Takes the node's address (a Node is one): the same aggregate can
 * sit below different parents in other workspaces or dimensions.
 *
 * "As far as observed" is the honest contract: a node reached without ever
 * reading its parent's children yields just itself. Callers that need the
 * full chain for a decision must either have walked the tree down to the node
 * (which the trees do) or ask the server, which always knows.
 */
export function observedIdPath(address: NodeAddress): string[] {
  const parentOf = (nodeAggregateId: string) =>
    observedNodeParents.get(nodeAddressKey({ ...address, nodeAggregateId }))
  const path = [address.nodeAggregateId]
  const seen = new Set(path)
  let current = parentOf(address.nodeAggregateId)
  // Not paranoia about cycles in the content graph but about a stale map
  // during a move: two entries can briefly point at each other.
  while (current !== undefined && !seen.has(current)) {
    path.push(current)
    seen.add(current)
    current = parentOf(current)
  }
  return path
}

/**
 * The child nodes, with hasChildren of the node types, each seeded into its
 * own node query, so a later fetchNode()/useNode() for a child resolves
 * without a request.
 */
export async function fetchChildren(
  address: NodeAddress,
  nodeTypes?: string,
  /**
   * List the children of a removed (deleted) node - the content of a deleted
   * page, which inherits its "removed" tag and is invisible without this.
   */
  removed = false,
): Promise<Node[]> {
  const nodes = await queryClient.fetchQuery({
    queryKey: neosKeys.nodes.children(address, nodeTypes, removed),
    queryFn: ({ signal }) =>
      fetchAllPages((page) =>
        unwrap(
          api.GET(NODES, {
            params: {
              path: { contentRepositoryId: address.contentRepositoryId },
              query: {
                ...subgraphOf(address),
                filterByHierarchy: {
                  type: 'childOf',
                  nodeAggregateId: address.nodeAggregateId,
                },
                filterByNodeType: nodeTypes || undefined,
                ...hasChildrenParams(nodeTypes, removed),
                ...page,
              },
            },
            signal,
          }),
        ),
      ),
  })
  for (const node of nodes) {
    // Seeded under the filter this list was read with, so a later
    // fetchNode(child, nodeTypes) with a matching filter resolves from cache.
    queryClient.setQueryData(neosKeys.nodes.get(node, nodeTypes, removed), node)
    observedNodeParents.set(
      nodeAddressKey({ ...address, nodeAggregateId: node.nodeAggregateId }),
      address.nodeAggregateId,
    )
  }
  return nodes
}
