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

/** Imperative variant for non-hook contexts (e.g. the tree data loader). */
export function fetchNode(address: string): Promise<NodeDto> {
  return queryClient.fetchQuery({
    queryKey: queryKeys.nodes.byAddress(address),
    queryFn: () => apiFetch<NodeDto>(`/nodes/${address}`),
  })
}

/**
 * Fetches child nodes and seeds each child into its own node query cache, so
 * a later fetchNode()/useNode() for a child resolves without a request.
 */
export async function fetchChildren(address: string, nodeTypes?: string): Promise<NodeDto[]> {
  const { nodes } = await queryClient.fetchQuery({
    queryKey: queryKeys.nodes.children(address, nodeTypes),
    queryFn: () =>
      apiFetch<{ nodes: NodeDto[] }>(
        `/nodes/${address}/children${nodeTypes ? `?nodeTypes=${encodeURIComponent(nodeTypes)}` : ''}`,
      ),
  })
  for (const node of nodes) {
    queryClient.setQueryData(queryKeys.nodes.byAddress(node.address), node)
  }
  return nodes
}
