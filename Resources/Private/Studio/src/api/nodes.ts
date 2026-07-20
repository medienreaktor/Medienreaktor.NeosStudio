import { useQuery } from '@tanstack/react-query'
import { queryClient } from '@/app/queryClient'
import { apiFetch } from './client'
import { dimensionSpacePointEquals } from './dimensions'
import { queryKeys } from './keys'

export interface SerializedPropertyValue {
  value: unknown
  type: string
}

export interface NodeDto {
  address: string
  aggregateId: string
  nodeType: string
  name: string | null
  /**
   * Display label computed server-side (the canonical Neos node label: node
   * type label expression, tethered-collection label, or nodeType/name
   * fallback), with HTML entities decoded to plain text. Prefer this over
   * deriving a label from properties on the client.
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
  properties: Record<string, SerializedPropertyValue>
  tags: { all: string[]; inherited: string[] }
  timestamps: {
    created: string
    originalCreated: string
    lastModified: string | null
    originalLastModified: string | null
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

export function useNode(address: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.nodes.byAddress(address),
    queryFn: () => apiFetch<NodeDto>(`/nodes/${address}`),
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
): Promise<NodeDto> {
  return queryClient.fetchQuery({
    queryKey: queryKeys.nodes.byAddress(address, nodeTypes),
    queryFn: () =>
      apiFetch<NodeDto>(
        `/nodes/${address}${nodeTypes ? `?nodeTypes=${encodeURIComponent(nodeTypes)}` : ''}`,
      ),
  })
}

/**
 * Renders one content element out-of-band: the HTML fragment the page's
 * Fusion produces for this node at the given rendering entry point (the
 * data-__neos-fusion-path attribute of the currently rendered element).
 * mode "inPlace" keeps the editing metadata attributes in the markup, so the
 * fragment can replace the live element in the preview. Never cached - the
 * point is a fresh render after an edit.
 */
export function renderNodeElement(
  address: string,
  fusionPath: string,
): Promise<string> {
  return apiFetch<string>(
    `/nodes/${address}/render?mode=inPlace&fusionPath=${encodeURIComponent(fusionPath)}`,
  )
}

/**
 * Builds a URL path segment (slug) for the node from the given text - or from
 * the node's label when the text is empty - using the server's language-aware
 * transliteration. This is the same generator the classic UI's uriPathSegment
 * "sync" button calls, so German umlauts and the like slugify identically
 * (ä→ae, ö→oe, ü→ue, ß→ss).
 */
export function generateUriPathSegment(
  address: string,
  text: string,
): Promise<string> {
  const query = text ? `?text=${encodeURIComponent(text)}` : ''
  return apiFetch<{ slug: string }>(
    `/nodes/${address}/uri-path-segment${query}`,
  ).then(({ slug }) => slug)
}

/**
 * Where a node aggregate exists: its own variants (occupied origins) and all
 * dimension space points it is reachable in, including specialization
 * shine-through (covered). A point outside "covered" needs a
 * CreateNodeVariant command before the node appears there.
 */
export interface NodeVariantsDto {
  occupiedDimensionSpacePoints: Record<string, string>[]
  coveredDimensionSpacePoints: Record<string, string>[]
}

export function useNodeVariants(address: string | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.nodes.variants(address ?? ''),
    queryFn: () => apiFetch<NodeVariantsDto>(`/nodes/${address}/variants`),
    enabled: enabled && address !== null,
  })
}

/** Imperative variant for non-hook contexts. */
export function fetchNodeVariants(address: string): Promise<NodeVariantsDto> {
  return queryClient.fetchQuery({
    queryKey: queryKeys.nodes.variants(address),
    queryFn: () => apiFetch<NodeVariantsDto>(`/nodes/${address}/variants`),
  })
}

/**
 * The node types the content model allows as children of this node (honoring
 * tethered-collection constraints server-side). Used to validate tree
 * drag-and-drop targets. Cached for the session - a node's constraints follow
 * from its (immutable) node type and tethered position, so they never change
 * mid-session; only a deployment could, like the node type model itself.
 */
export function fetchAllowedChildNodeTypes(address: string): Promise<string[]> {
  // Unwrap inside the queryFn so the cache holds the string[] itself - the
  // DnD canDrop reads it back synchronously with getQueryData and calls
  // .includes() on it, so the cached shape must be the array, not { nodeTypes }.
  return queryClient.fetchQuery({
    queryKey: queryKeys.nodes.allowedChildNodeTypes(address),
    queryFn: async () => {
      const { nodeTypes } = await apiFetch<{ nodeTypes: string[] }>(
        `/nodes/${address}/allowed-child-node-types`,
      )
      return nodeTypes
    },
    staleTime: Infinity,
  })
}

/**
 * Hook variant of fetchAllowedChildNodeTypes, sharing its cache entries (same
 * key, same unwrapped string[] shape). null disables the query - e.g. a
 * sibling-insertion check while the parent is still unknown.
 */
export function useAllowedChildNodeTypes(address: string | null) {
  return useQuery({
    queryKey: queryKeys.nodes.allowedChildNodeTypes(address ?? ''),
    queryFn: async () => {
      const { nodeTypes } = await apiFetch<{ nodeTypes: string[] }>(
        `/nodes/${address}/allowed-child-node-types`,
      )
      return nodeTypes
    },
    staleTime: Infinity,
    enabled: address !== null,
  })
}

/** Ancestors, closest first (parent, grandparent, ... up to the root). */
export function useNodeAncestors(address: string | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.nodes.ancestors(address ?? ''),
    queryFn: () =>
      apiFetch<{ nodes: NodeDto[] }>(`/nodes/${address}/ancestors`),
    enabled: enabled && address !== null,
    select: (data) => data.nodes,
  })
}

/** Imperative variant for non-hook contexts (e.g. the tree breadcrumb loader). */
export function fetchAncestors(
  address: string,
  nodeTypes?: string,
): Promise<NodeDto[]> {
  return queryClient
    .fetchQuery({
      queryKey: queryKeys.nodes.ancestors(address, nodeTypes),
      queryFn: () =>
        apiFetch<{ nodes: NodeDto[] }>(
          `/nodes/${address}/ancestors${nodeTypes ? `?nodeTypes=${encodeURIComponent(nodeTypes)}` : ''}`,
        ),
    })
    .then(({ nodes }) => nodes)
}

/** One outgoing reference of a node, with the target node resolved. */
export interface NodeReferenceDto {
  /** The reference name = the property name in the node type configuration. */
  referenceName: string
  node: NodeDto
  properties: Record<string, unknown> | null
}

/**
 * All outgoing references of a node, in stored order. Reference "properties"
 * are not part of node.properties in Neos 9 - this relation is where a
 * reference editor reads its current value from. Invalidated by the
 * nodes.node(address) prefix after every save.
 */
export function useNodeReferences(address: string | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.nodes.references(address ?? ''),
    queryFn: () =>
      apiFetch<{ references: NodeReferenceDto[] }>(
        `/nodes/${address}/references`,
      ),
    enabled: enabled && address !== null,
    select: (data) => data.references,
  })
}

/** A search hit: a node plus the document breadcrumb that locates it. */
export interface NodeSearchResult extends NodeDto {
  /** Document labels from the site down to the node, e.g. ["Home", "Blog", "Post"]. */
  breadcrumb: string[]
}

/**
 * Fulltext search over the descendants of a context node (typically the site
 * root) - what reference editors and pickers use for search-as-you-type.
 */
export function searchNodes(
  contextAddress: string,
  term: string,
  nodeTypes: string,
  limit = 20,
): Promise<NodeSearchResult[]> {
  const params = new URLSearchParams({
    search: term,
    nodeTypes,
    limit: String(limit),
  })
  return apiFetch<{ nodes: NodeSearchResult[] }>(
    `/nodes/${contextAddress}/descendants?${params.toString()}`,
  ).then(({ nodes }) => nodes)
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
    queryFn: () => {
      const params = new URLSearchParams({ nodeTypes, breadcrumbs: '1' })
      if (term !== '') {
        params.set('search', term)
        params.set('searchProperty', 'title')
      }
      return apiFetch<{ nodes: NodeSearchResult[] }>(
        `/nodes/${contextAddress}/descendants?${params.toString()}`,
      ).then(({ nodes }) => nodes)
    },
    enabled: enabled && contextAddress !== null,
  })
}

/**
 * Fetches child nodes and seeds each child into its own node query cache, so
 * a later fetchNode()/useNode() for a child resolves without a request.
 */
export async function fetchChildren(
  address: string,
  nodeTypes?: string,
): Promise<NodeDto[]> {
  const { nodes } = await queryClient.fetchQuery({
    queryKey: queryKeys.nodes.children(address, nodeTypes),
    queryFn: () =>
      apiFetch<{ nodes: NodeDto[] }>(
        `/nodes/${address}/children${nodeTypes ? `?nodeTypes=${encodeURIComponent(nodeTypes)}` : ''}`,
      ),
  })
  for (const node of nodes) {
    // Seed under the same filter this list was fetched with, so a later
    // fetchNode(address, nodeTypes) with a matching filter resolves from
    // cache instead of re-fetching an unfiltered (differently-scoped)
    // hasChildren.
    queryClient.setQueryData(
      queryKeys.nodes.byAddress(node.address, nodeTypes),
      node,
    )
  }
  return nodes
}
