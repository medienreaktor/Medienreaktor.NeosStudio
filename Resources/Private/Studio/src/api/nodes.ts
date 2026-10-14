import { useQuery } from '@tanstack/react-query'
import { queryClient } from '@/app/queryClient'
import { apiFetch, fetchAllPages, type Listing, queryString } from './client'
import {
  type DimensionSpacePoint,
  dimensionSpacePointEquals,
} from './dimensions'
import { queryKeys } from './keys'
import {
  addressOf,
  aggregateIdOf,
  decodeNodeAddress,
  nodeLocation,
  type NodeLocation,
} from './nodeAddress'
import {
  fetchChildNodeConstraints,
  fetchNodeTypeMap,
  isOfType,
  matchesNodeTypeFilter,
} from './nodeTypes'

export interface NodeDto {
  address: string
  aggregateId: string
  nodeType: string
  name: string | null
  /**
   * Display label computed server-side (the canonical Neos node label: node
   * type label expression, tethered-collection label, or nodeType/name
   * fallback) as plain text. Prefer this over deriving a label from
   * properties on the client.
   */
  label: string
  classification: string
  /**
   * Whether the node has visible children; when the response came from a
   * nodeTypes-filtered children/descendants request, the same filter applies
   * (a document listing reports "has document children").
   */
  hasChildren: boolean
  workspace: string
  dimensionSpacePoint: Record<string, string>
  originDimensionSpacePoint: Record<string, string>
  /**
   * The property values by name, in their serialized form (e.g. a date as
   * ISO 8601 string, an asset as {id, url}) - plain values, no envelope.
   */
  properties: Record<string, unknown>
  tags: { all: string[]; inherited: string[] }
  timestamps: {
    created: string
    originalCreated: string
    lastModified: string | null
    originalLastModified: string | null
  }
}

/** A node as Neos.Api returns it (getNode, listNodes, writes). */
export interface ApiNode {
  contentRepositoryId: string
  workspaceName: string
  /** JSON string. */
  dimensionSpacePoint: string
  /** JSON string; the point whose content the node shows. */
  originDimensionSpacePoint?: string
  nodeAggregateId: string
  name: string | null
  nodeType: string
  label: string
  classification: string
  isHidden: boolean
  isHiddenByAncestor: boolean
  isShineThrough: boolean
  /** The tags set on the node itself. */
  tags: string[]
  /** The tags it has from its ancestors. */
  inheritedTags: string[]
  timestamps: NodeDto['timestamps']
  properties: Record<string, unknown>
  references: Record<
    string,
    {
      nodeAggregateId: string
      properties: Record<string, unknown> | null
      node?: ApiNode | null
    }[]
  > | null
  children: ApiNode[] | null
  variants: ApiNode[] | null
  ancestors: ApiNode[] | null
  hasChildren?: boolean | null
}

/**
 * The shell's NodeDto for a Neos.Api node. hasChildren is only known when
 * the request included it - `hasChildrenFallback` stands in otherwise (true
 * for ancestors, which have at least the node they were read for).
 */
export function toNodeDto(node: ApiNode, hasChildrenFallback = false): NodeDto {
  const dimensionSpacePoint = JSON.parse(
    node.dimensionSpacePoint,
  ) as DimensionSpacePoint
  return {
    address: addressOf(node),
    aggregateId: node.nodeAggregateId,
    nodeType: node.nodeType,
    name: node.name,
    label: node.label,
    classification: node.classification,
    hasChildren: node.hasChildren ?? hasChildrenFallback,
    workspace: node.workspaceName,
    dimensionSpacePoint,
    originDimensionSpacePoint: node.originDimensionSpacePoint
      ? (JSON.parse(node.originDimensionSpacePoint) as DimensionSpacePoint)
      : dimensionSpacePoint,
    properties: node.properties ?? {},
    tags: {
      all: [...new Set([...node.tags, ...node.inheritedTags])].sort(),
      inherited: node.inheritedTags,
    },
    timestamps: node.timestamps,
  }
}

/** workspaceName and dimensionSpacePoint of a location, for a query string. */
function subgraphOf(location: NodeLocation) {
  return {
    workspaceName: location.workspaceName,
    dimensionSpacePoint: location.dimensionSpacePoint,
  }
}

/** GET a single node at the address with the given extra query parameters. */
function getNode(
  address: string,
  params: Record<string, string | boolean | undefined>,
): Promise<ApiNode> {
  const location = nodeLocation(address)
  return apiFetch<ApiNode>(
    `${location.path}${queryString({ ...subgraphOf(location), ...params })}`,
  )
}

/** Query parameters reading hasChildren (optionally of node types) and removed nodes. */
function hasChildrenParams(nodeTypes?: string, includeDeleted = false) {
  return {
    hasChildrenOfNodeType: nodeTypes || undefined,
    includeRemoved: includeDeleted || undefined,
  }
}

export const DOCUMENT_NODE_TYPE = 'Neos.Neos:Document'

/**
 * The content structure below a document: collections (e.g. "main") are not
 * Neos.Neos:Content subtypes, so both types are needed to outline content.
 */
export const CONTENT_NODE_TYPES =
  'Neos.Neos:Content,Neos.Neos:ContentCollection'

/**
 * Whether the node itself is hidden (tagged "disabled" on the node, not
 * merely inherited from a hidden ancestor) - only then does unhiding it
 * change anything.
 */
export function isExplicitlyHidden(node: NodeDto): boolean {
  return (
    node.tags.all.includes('disabled') &&
    !node.tags.inherited.includes('disabled')
  )
}

/**
 * Whether the node is deleted: deleting is a soft removal, so a deleted node
 * still exists (tagged "removed") and can be read, rendered and restored -
 * ordinary reads just exclude it. True for the deleted node itself and for
 * everything inside it, which inherits the tag.
 */
export function isDeleted(node: NodeDto): boolean {
  return node.tags.all.includes('removed')
}

/**
 * Whether the node only exists here through dimension fallback ("shines
 * through"): it is viewed in a dimension it does not originate in. Editing
 * such a node first creates a variant in the viewed dimension (see
 * persistProperty's withVariantHandling).
 */
export function isShineThrough(node: NodeDto): boolean {
  return !dimensionSpacePointEquals(
    node.dimensionSpacePoint,
    node.originDimensionSpacePoint,
  )
}

/**
 * The node's display label. The server computes the canonical Neos label and
 * ships it as `label`; the aggregate id is only a last resort for older/partial
 * data that predates the field.
 */
export function nodeLabel(node: NodeDto): string {
  return node.label !== '' ? node.label : node.aggregateId
}

function loadNode(
  address: string,
  nodeTypes?: string,
  includeDeleted = false,
): Promise<NodeDto> {
  return getNode(address, {
    include: 'hasChildren',
    ...hasChildrenParams(nodeTypes, includeDeleted),
  }).then((node) => toNodeDto(node))
}

export function useNode(address: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.nodes.byAddress(address),
    queryFn: () => loadNode(address),
    enabled,
  })
}

/**
 * Imperative variant for non-hook contexts (e.g. the tree data loader).
 * Pass the same nodeTypes filter the caller uses for hasChildren elsewhere
 * (e.g. a tree's children fetch), or it is reported unfiltered ("has any
 * children").
 */
export function fetchNode(
  address: string,
  nodeTypes?: string,
  /** Read a DELETED node - without this it does not exist for the API. */
  includeDeleted = false,
): Promise<NodeDto> {
  return queryClient.fetchQuery({
    queryKey: queryKeys.nodes.byAddress(address, nodeTypes, includeDeleted),
    queryFn: () => loadNode(address, nodeTypes, includeDeleted),
  })
}

/**
 * Renders one content element out-of-band: the HTML fragment the page's
 * Fusion produces for this node at the given rendering entry point (the
 * data-__neos-fusion-path attribute of the currently rendered element), via
 * Neos.Api's fusionPathHtml view. Rendering mode "inPlace" keeps the editing
 * metadata attributes in the markup, so the fragment can replace the live
 * element in the preview. Never cached - the point is a fresh render after
 * an edit (apiFetch never lets the browser cache answer).
 *
 * An element that fails to render comes back with the error rendered in its
 * place, as in the Neos backend; a 4xx (unknown/stale path, missing node)
 * rejects, and so does a response without HTML - callers fall back to a full
 * reload then.
 */
export async function renderNodeElement(
  address: string,
  fusionPath: string,
): Promise<string> {
  const node = decodeNodeAddress(address)
  const { html } = await apiFetch<{ html?: unknown }>(
    `/views/fusionPathHtml${queryString({
      contentRepositoryId: node.contentRepositoryId,
      nodeAggregateId: node.aggregateId,
      workspaceName: node.workspaceName,
      dimensionSpacePoint: JSON.stringify(node.dimensionSpacePoint),
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
 * Builds a URL path segment (slug) for the node from the given text - or from
 * the node's title/label when the text is empty - using the server's
 * language-aware transliteration. This is the same generator the classic UI's
 * uriPathSegment "sync" button uses, so German umlauts and the like slugify
 * identically (ä→ae, ö→oe, ü→ue, ß→ss). Read-only: nothing is written.
 */
export function generateUriPathSegment(
  address: string,
  text: string,
): Promise<string> {
  const location = nodeLocation(address)
  return apiFetch<{ uriPathSegment: string }>(
    `${location.path}/uripathsegment${queryString({
      ...subgraphOf(location),
      text: text || undefined,
    })}`,
  ).then(({ uriPathSegment }) => uriPathSegment)
}

/**
 * Where a node aggregate exists: its own variants (occupied origins) and all
 * dimension space points it is reachable in, including specialization
 * shine-through (covered). A point outside "covered" needs a variant
 * (createNodeVariant) before the node appears there.
 */
export interface NodeVariantsDto {
  occupiedDimensionSpacePoints: Record<string, string>[]
  coveredDimensionSpacePoints: Record<string, string>[]
}

async function loadNodeVariants(address: string): Promise<NodeVariantsDto> {
  const location = nodeLocation(address)
  const listing = await apiFetch<
    Listing<ApiNode, { total: number; coveredDimensionSpacePoints?: string[] }>
  >(
    `${location.path}/variants${queryString({ workspaceName: location.workspaceName })}`,
  )
  return {
    occupiedDimensionSpacePoints: listing.data.map(
      (variant) =>
        JSON.parse(variant.dimensionSpacePoint) as DimensionSpacePoint,
    ),
    coveredDimensionSpacePoints: (
      listing.meta.coveredDimensionSpacePoints ?? []
    ).map((point) => JSON.parse(point) as DimensionSpacePoint),
  }
}

export function useNodeVariants(address: string | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.nodes.variants(address ?? ''),
    queryFn: () => loadNodeVariants(address!),
    enabled: enabled && address !== null,
  })
}

/** Imperative variant for non-hook contexts. */
export function fetchNodeVariants(address: string): Promise<NodeVariantsDto> {
  return queryClient.fetchQuery({
    queryKey: queryKeys.nodes.variants(address),
    queryFn: () => loadNodeVariants(address),
  })
}

/**
 * The node types the content model allows as children of the node, derived
 * from the node type model like the classic UI: for a tethered node (an
 * autocreated collection) the constraints of its parent's tethered child node
 * definition apply, for any other node its own node type's.
 */
async function loadAllowedChildNodeTypes(address: string): Promise<string[]> {
  const [node, constraints] = await Promise.all([
    getNode(address, { include: 'ancestors' }),
    fetchChildNodeConstraints(),
  ])
  if (node.classification === 'tethered' && node.name !== null) {
    const parent = node.ancestors?.[0]
    const tethered =
      parent !== undefined
        ? constraints.get(parent.nodeType)?.tethered[node.name]
        : undefined
    if (tethered !== undefined) return tethered
  }
  return constraints.get(node.nodeType)?.allowed ?? []
}

/**
 * The node types the content model allows as children of this node (honoring
 * tethered-collection constraints). Used to validate tree drag-and-drop
 * targets. Cached for the session - a node's constraints follow from its
 * (immutable) node type and tethered position, so they never change
 * mid-session; only a deployment could, like the node type model itself.
 */
export function fetchAllowedChildNodeTypes(address: string): Promise<string[]> {
  // The cache holds the string[] itself - the DnD canDrop reads it back
  // synchronously with getQueryData and calls .includes() on it.
  return queryClient.fetchQuery({
    queryKey: queryKeys.nodes.allowedChildNodeTypes(address),
    queryFn: () => loadAllowedChildNodeTypes(address),
    staleTime: Infinity,
  })
}

/**
 * Hook variant of fetchAllowedChildNodeTypes, sharing its cache entries (same
 * key, same string[] shape). null disables the query - e.g. a
 * sibling-insertion check while the parent is still unknown.
 */
export function useAllowedChildNodeTypes(address: string | null) {
  return useQuery({
    queryKey: queryKeys.nodes.allowedChildNodeTypes(address ?? ''),
    queryFn: () => loadAllowedChildNodeTypes(address!),
    staleTime: Infinity,
    enabled: address !== null,
  })
}

/**
 * Ancestors, closest first (parent, grandparent, ... up to the site node -
 * the content repository root is not included), optionally only those of the
 * given node types (NodeTypeCriteria syntax, matched against the node type
 * model).
 */
async function loadAncestors(
  address: string,
  nodeTypes?: string,
): Promise<NodeDto[]> {
  const [node, nodeTypeMap] = await Promise.all([
    getNode(address, { include: 'ancestors' }),
    nodeTypes ? fetchNodeTypeMap() : Promise.resolve(null),
  ])
  return (node.ancestors ?? [])
    .filter(
      (ancestor) =>
        nodeTypeMap === null ||
        matchesNodeTypeFilter(nodeTypeMap, ancestor.nodeType, nodeTypes!),
    )
    .map((ancestor) => toNodeDto(ancestor, true))
}

/** Ancestors, closest first (parent, grandparent, ... up to the site node). */
export function useNodeAncestors(address: string | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.nodes.ancestors(address ?? ''),
    queryFn: () => loadAncestors(address!),
    enabled: enabled && address !== null,
  })
}

/** Imperative variant for non-hook contexts (e.g. the tree breadcrumb loader). */
export function fetchAncestors(
  address: string,
  nodeTypes?: string,
): Promise<NodeDto[]> {
  return queryClient.fetchQuery({
    queryKey: queryKeys.nodes.ancestors(address, nodeTypes),
    queryFn: () => loadAncestors(address, nodeTypes),
  })
}

/** One outgoing reference of a node, with the target node resolved. */
export interface NodeReferenceDto {
  /** The reference name = the property name in the node type configuration. */
  referenceName: string
  node: NodeDto
  properties: Record<string, unknown> | null
}

/**
 * All outgoing references of a node, in stored order per reference name.
 * Reference "properties" are not part of node.properties in Neos 9 - this
 * relation is where a reference editor reads its current value from. Targets
 * the account may not read are left out. Invalidated by the
 * nodes.node(address) prefix after every save.
 */
export function useNodeReferences(address: string | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.nodes.references(address ?? ''),
    queryFn: async (): Promise<NodeReferenceDto[]> => {
      const node = await getNode(address!, { include: 'references.node' })
      const references: NodeReferenceDto[] = []
      for (const [referenceName, items] of Object.entries(
        node.references ?? {},
      )) {
        for (const item of items) {
          if (!item.node) continue
          references.push({
            referenceName,
            node: toNodeDto(item.node),
            properties: item.properties,
          })
        }
      }
      return references
    },
    enabled: enabled && address !== null,
  })
}

/** A search hit: a node plus the document breadcrumb that locates it. */
export interface NodeSearchResult extends NodeDto {
  /** Document labels from the site down to the node, e.g. ["Home", "Blog", "Post"]. */
  breadcrumb: string[]
}

/** The query parameters listing the descendants of a context node. */
function descendantsParams(contextAddress: string, nodeTypes: string) {
  const context = nodeLocation(contextAddress)
  return {
    collectionPath: context.collectionPath,
    params: {
      ...subgraphOf(context),
      'filterByHierarchy[type]': 'descendantOf',
      'filterByHierarchy[nodeAggregateId]': aggregateIdOf(contextAddress),
      filterByNodeType: nodeTypes || undefined,
      // The ancestors carry the breadcrumb.
      include: 'ancestors',
    },
  }
}

/**
 * The search hit for a listed node (read with include=ancestors): document
 * labels from the site down, then the node's own label - like the old
 * NodeSerializer::breadcrumb.
 */
function toSearchResult(
  node: ApiNode,
  nodeTypeMap: Awaited<ReturnType<typeof fetchNodeTypeMap>>,
): NodeSearchResult {
  const documents = (node.ancestors ?? []).filter((ancestor) =>
    isOfType(nodeTypeMap, ancestor.nodeType, DOCUMENT_NODE_TYPE),
  )
  return {
    ...toNodeDto(node),
    breadcrumb: [
      ...documents.map((ancestor) => ancestor.label).reverse(),
      node.label,
    ],
  }
}

/**
 * Fulltext search over the descendants of a context node (typically the site
 * root) - what reference editors and pickers use for search-as-you-type.
 */
export async function searchNodes(
  contextAddress: string,
  term: string,
  nodeTypes: string,
  limit = 20,
): Promise<NodeSearchResult[]> {
  const { collectionPath, params } = descendantsParams(
    contextAddress,
    nodeTypes,
  )
  const [listing, nodeTypeMap] = await Promise.all([
    apiFetch<Listing<ApiNode>>(
      `${collectionPath}${queryString({ ...params, search: term || undefined, limit })}`,
    ),
    fetchNodeTypeMap(),
  ])
  return listing.data.map((node) => toSearchResult(node, nodeTypeMap))
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
 * All matching descendants of a context node (typically the site root),
 * regardless of tree depth and without pagination - the document toolbar's
 * search/filter listing. A term matches against the title property
 * (case-insensitive contains) rather than the fulltext search, and every
 * result carries its document breadcrumb, term or not.
 */
export function useFilteredDescendants(
  contextAddress: string | null,
  term: string,
  nodeTypes: string,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.nodes.filteredDescendants(
      contextAddress ?? '',
      nodeTypes,
      term,
    ),
    queryFn: async () => {
      const { collectionPath, params } = descendantsParams(
        contextAddress!,
        nodeTypes,
      )
      const [nodes, nodeTypeMap] = await Promise.all([
        fetchAllPages<ApiNode>(
          `${collectionPath}${queryString({
            ...params,
            filterByProperty:
              term !== ''
                ? `title *=~ ${propertyCriteriaLiteral(term)}`
                : undefined,
          })}`,
        ),
        fetchNodeTypeMap(),
      ])
      return nodes.map((node) => toSearchResult(node, nodeTypeMap))
    },
    enabled: enabled && contextAddress !== null,
  })
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
export function observedIdPath(aggregateId: string): string[] {
  const path = [aggregateId]
  const seen = new Set(path)
  let current = observedNodeParents.get(aggregateId)
  // The `seen` guard is not paranoia about cycles in the content graph but
  // about a stale map during a move: two entries can briefly point at each
  // other, and an unguarded walk would hang the render.
  while (current !== undefined && !seen.has(current)) {
    path.push(current)
    seen.add(current)
    current = observedNodeParents.get(current)
  }
  return path
}

/**
 * Fetches child nodes and seeds each child into its own node query cache, so
 * a later fetchNode()/useNode() for a child resolves without a request.
 */
export async function fetchChildren(
  address: string,
  nodeTypes?: string,
  /**
   * List children of a DELETED node - the content of a deleted page, which
   * inherits its "removed" tag and is invisible without this.
   */
  includeDeleted = false,
): Promise<NodeDto[]> {
  const nodes = await queryClient.fetchQuery({
    queryKey: queryKeys.nodes.children(address, nodeTypes, includeDeleted),
    queryFn: async () => {
      const location = nodeLocation(address)
      const children = await fetchAllPages<ApiNode>(
        `${location.collectionPath}${queryString({
          ...subgraphOf(location),
          'filterByHierarchy[type]': 'childOf',
          'filterByHierarchy[nodeAggregateId]': aggregateIdOf(address),
          filterByNodeType: nodeTypes || undefined,
          include: 'hasChildren',
          ...hasChildrenParams(nodeTypes, includeDeleted),
        })}`,
      )
      return children.map((child) => toNodeDto(child))
    },
  })
  const parentAggregateId = aggregateIdOf(address)
  for (const node of nodes) {
    // Seed under the same filter this list was fetched with, so a later
    // fetchNode(address, nodeTypes) with a matching filter resolves from
    // cache instead of re-fetching an unfiltered (differently-scoped)
    // hasChildren.
    queryClient.setQueryData(
      queryKeys.nodes.byAddress(node.address, nodeTypes, includeDeleted),
      node,
    )
    observedNodeParents.set(node.aggregateId, parentAggregateId)
  }
  return nodes
}
