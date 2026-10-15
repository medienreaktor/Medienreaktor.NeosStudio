import { useQuery } from '@tanstack/react-query'
import { queryClient } from '@/app/queryClient'
import { queryString } from '../../http/request'
import { apiFetch, contentRepositoryPath, fetchAllPages } from '../client'
import { neosKeys } from '../keys'
import type {
  Node,
  NodeAddress,
  NodeReference,
  NodeVariantListing,
  UriPathSegment,
  ViewData,
} from '../schema'
import {
  fetchNodeTypes,
  isOfType,
  matchesNodeTypeFilter,
  nodeTypeMap,
} from './nodeTypes'

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

/** `/cr/{contentRepositoryId}/nodes`, for listings and creation. */
export function nodesPath(address: Pick<NodeAddress, 'contentRepositoryId'>) {
  return `${contentRepositoryPath(address.contentRepositoryId)}/nodes`
}

/** `/cr/{contentRepositoryId}/nodes/{nodeAggregateId}{suffix}`. */
export function nodePath(address: NodeAddress, suffix = ''): string {
  return `${nodesPath(address)}/${encodeURIComponent(address.nodeAggregateId)}${suffix}`
}

/** The subgraph of the address, as the query parameters of a node operation. */
export function subgraphOf(address: NodeAddress) {
  return {
    workspaceName: address.workspaceName,
    dimensionSpacePoint: address.dimensionSpacePoint,
  }
}

/** GET the node at the address, with the given further query parameters. */
export function getNode(
  address: NodeAddress,
  params: Record<string, string | boolean | undefined> = {},
): Promise<Node> {
  return apiFetch<Node>(
    nodePath(address, queryString({ ...subgraphOf(address), ...params })),
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
): Promise<Node> {
  return getNode(address, hasChildrenParams(nodeTypes, removed))
}

export function useNode(address: NodeAddress | null, enabled = true) {
  return useQuery({
    queryKey: neosKeys.nodes.get(address),
    queryFn: () => loadNode(address!),
    enabled: enabled && address !== null,
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
    queryFn: () => loadNode(address, nodeTypes, removed),
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
): Promise<string> {
  const { html } = await apiFetch<ViewData & { html?: unknown }>(
    `/views/fusionPathHtml${queryString({
      contentRepositoryId: address.contentRepositoryId,
      nodeAggregateId: address.nodeAggregateId,
      ...subgraphOf(address),
      renderingMode: 'inPlace',
      'arguments[fusionPath]': fusionPath,
    })}`,
  )
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
): Promise<string> {
  const { uriPathSegment } = await apiFetch<UriPathSegment>(
    nodePath(
      address,
      `/uripathsegment${queryString({ ...subgraphOf(address), text: text || undefined })}`,
    ),
  )
  return uriPathSegment
}

/**
 * The variants of the node aggregate (data: one node per occupied dimension
 * space point) and every point it is reachable in (meta.coveredDimensionSpacePoints,
 * shine-through included). A point outside them needs a variant first.
 */
function loadNodeVariants(address: NodeAddress): Promise<NodeVariantListing> {
  return apiFetch<NodeVariantListing>(
    nodePath(
      address,
      `/variants${queryString({ workspaceName: address.workspaceName })}`,
    ),
  )
}

export function useNodeVariants(address: NodeAddress | null, enabled = true) {
  return useQuery({
    queryKey: neosKeys.nodes.variants(address),
    queryFn: () => loadNodeVariants(address!),
    enabled: enabled && address !== null,
  })
}

/** Imperative variant of useNodeVariants. */
export function fetchNodeVariants(
  address: NodeAddress,
): Promise<NodeVariantListing> {
  return queryClient.fetchQuery({
    queryKey: neosKeys.nodes.variants(address),
    queryFn: () => loadNodeVariants(address),
  })
}

/**
 * The node types the content model allows as children of the node, as the
 * classic UI derives them: for a tethered node (an autocreated collection)
 * the constraints of its parent's tethered child node, for any other node its
 * own node type's.
 */
async function loadAllowedChildNodeTypes(
  address: NodeAddress,
): Promise<string[]> {
  const [node, nodeTypes] = await Promise.all([
    getNode(address, { include: 'ancestors' }),
    fetchNodeTypes('allowedChildNodeTypes,tetheredChildNodes'),
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
    queryFn: () => loadAllowedChildNodeTypes(address),
    staleTime: Infinity,
  })
}

/** Hook variant of fetchAllowedChildNodeTypes, sharing its cache entries. */
export function useAllowedChildNodeTypes(address: NodeAddress | null) {
  return useQuery({
    queryKey: neosKeys.nodes.allowedChildNodeTypes(address),
    queryFn: () => loadAllowedChildNodeTypes(address!),
    staleTime: Infinity,
    enabled: address !== null,
  })
}

/**
 * The ancestors, closest first (parent, grandparent, ... up to the site node -
 * the content repository root is not included).
 */
async function loadAncestors(address: NodeAddress): Promise<Node[]> {
  const node = await getNode(address, { include: 'ancestors' })
  return node.ancestors ?? []
}

export function useNodeAncestors(address: NodeAddress | null, enabled = true) {
  return useQuery({
    queryKey: neosKeys.nodes.ancestors(address),
    queryFn: () => loadAncestors(address!),
    enabled: enabled && address !== null,
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
      queryFn: () => loadAncestors(address),
    }),
    nodeTypes ? fetchNodeTypes() : Promise.resolve(null),
  ])
  if (types === null) return ancestors
  const map = nodeTypeMap(types)
  return ancestors.filter((ancestor) =>
    matchesNodeTypeFilter(map, ancestor.nodeType, nodeTypes!),
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
    queryFn: () => getNode(address!, { include: 'references.node' }),
    enabled: enabled && address !== null,
  })
}

/** The references of a node read with include=references, by name. */
export function nodeReferences(node: Node): Record<string, NodeReference[]> {
  return (node.references ?? {}) as Record<string, NodeReference[]>
}

/** The query listing the descendants of a node, with their ancestors. */
function descendantsQuery(
  context: NodeAddress,
  nodeTypes: string,
  params: Record<string, string | number | undefined>,
): string {
  return `${nodesPath(context)}${queryString({
    ...subgraphOf(context),
    'filterByHierarchy[type]': 'descendantOf',
    'filterByHierarchy[nodeAggregateId]': context.nodeAggregateId,
    filterByNodeType: nodeTypes || undefined,
    // The ancestors locate a hit: its breadcrumb, its place for access rules.
    include: 'ancestors',
    ...params,
  })}`
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
): Promise<Node[]> {
  const listing = await apiFetch<{ data: Node[] }>(
    descendantsQuery(context, nodeTypes, { search: term || undefined, limit }),
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
    queryFn: () =>
      fetchAllPages<Node>(
        descendantsQuery(context!, nodeTypes, {
          filterByProperty:
            title !== ''
              ? `title *=~ ${propertyCriteriaLiteral(title)}`
              : undefined,
        }),
      ),
    enabled: enabled && context !== null,
  })
}

/**
 * The labels of the documents from the site down to the node, the node's own
 * last - for a node read with its ancestors (search hits).
 */
export async function documentBreadcrumb(node: Node): Promise<string[]> {
  const types = nodeTypeMap(await fetchNodeTypes())
  return [
    ...(node.ancestors ?? [])
      .filter((ancestor) =>
        isOfType(types, ancestor.nodeType, DOCUMENT_NODE_TYPE),
      )
      .map((ancestor) => ancestor.label)
      .reverse(),
    node.label,
  ]
}

/**
 * Parent aggregate id per child aggregate id, observed while reading
 * children. Aggregate ids are stable across workspaces and dimensions, so one
 * map serves every subgraph - and structural moves refresh the children list
 * that fills it, which overwrites the entry.
 *
 * Kept outside the query cache on purpose: this is a fact about the content
 * graph, not a cached response, and consumers need it synchronously during
 * render (row decoration walks a node's ancestry).
 */
const observedNodeParents = new Map<string, string>()

/**
 * The ancestry of a node as far as it has been observed, node first and root
 * last - the shape ancestor-relative rules are evaluated against.
 *
 * "As far as observed" is the honest contract: a node reached without ever
 * reading its parent's children yields just itself. Callers that need the
 * full chain for a decision must either have walked the tree down to the node
 * (which the trees do) or ask the server, which always knows.
 */
export function observedIdPath(nodeAggregateId: string): string[] {
  const path = [nodeAggregateId]
  const seen = new Set(path)
  let current = observedNodeParents.get(nodeAggregateId)
  // Not paranoia about cycles in the content graph but about a stale map
  // during a move: two entries can briefly point at each other.
  while (current !== undefined && !seen.has(current)) {
    path.push(current)
    seen.add(current)
    current = observedNodeParents.get(current)
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
    queryFn: () =>
      fetchAllPages<Node>(
        `${nodesPath(address)}${queryString({
          ...subgraphOf(address),
          'filterByHierarchy[type]': 'childOf',
          'filterByHierarchy[nodeAggregateId]': address.nodeAggregateId,
          filterByNodeType: nodeTypes || undefined,
          ...hasChildrenParams(nodeTypes, removed),
        })}`,
      ),
  })
  for (const node of nodes) {
    // Seeded under the filter this list was read with, so a later
    // fetchNode(child, nodeTypes) with a matching filter resolves from cache.
    queryClient.setQueryData(neosKeys.nodes.get(node, nodeTypes, removed), node)
    observedNodeParents.set(node.nodeAggregateId, address.nodeAggregateId)
  }
  return nodes
}
