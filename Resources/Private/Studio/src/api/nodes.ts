import { useQuery } from '@tanstack/react-query'
import { queryClient } from '@/app/queryClient'
import { apiFetch } from './client'
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

export function nodeLabel(node: NodeDto): string {
  const title = node.properties['title']?.value
  if (typeof title === 'string' && title !== '') return title
  return node.name ?? node.aggregateId
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

/** Ancestors, closest first (parent, grandparent, ... up to the root). */
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
