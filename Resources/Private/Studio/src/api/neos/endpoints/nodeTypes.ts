import { skipToken, useQuery } from '@tanstack/react-query'
import { queryClient } from '@/app/queryClient'
import { useActiveContentRepositoryId } from '../activeContentRepository'
import { api, unwrap } from '../client'
import { neosKeys } from '../keys'
import type { NodeType, NodeTypeListing } from '../schema'

/**
 * The node types of a content repository (Neos.Api's NodeTypes tag) - the
 * hooks read the selected site's, the imperative reads name theirs. The
 * model changes on deployments, not during a session, so every read is
 * cached for good.
 */

/**
 * The node type listing with the given include (comma-separated: properties,
 * references, configuration, allowedChildNodeTypes, tetheredChildNodes), its
 * meta with the node type groups. The plain listing every consumer boots with
 * stays lean; the content model graph and the child constraints ask for more.
 */
function listingQuery(contentRepositoryId: string, include = '') {
  return {
    queryKey: neosKeys.nodeTypes.listing(contentRepositoryId, include),
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      unwrap(
        api.GET('/cr/{contentRepositoryId}/nodetypes', {
          params: {
            path: { contentRepositoryId },
            query: { include: include || undefined },
          },
          signal,
        }),
      ),
    staleTime: Infinity,
  }
}

export type NodeTypeMap = Map<string, NodeType>

const maps = new WeakMap<NodeType[], NodeTypeMap>()

/** The node types by name - one map per listing, so lookups stay cheap. */
export function nodeTypeMap(nodeTypes: NodeType[]): NodeTypeMap {
  let map = maps.get(nodeTypes)
  if (!map) {
    map = new Map(nodeTypes.map((nodeType) => [nodeType.name, nodeType]))
    maps.set(nodeTypes, map)
  }
  return map
}

/** The node types by name, with the given include (see listingQuery). */
export function useNodeTypes(include = '', enabled = true) {
  const contentRepositoryId = useActiveContentRepositoryId()
  const query = listingQuery(contentRepositoryId ?? '', include)
  return useQuery({
    ...query,
    queryFn:
      enabled && contentRepositoryId !== null ? query.queryFn : skipToken,
    select: (listing: NodeTypeListing) => nodeTypeMap(listing.data),
  })
}

/**
 * Imperative variant of useNodeTypes, same cache entries - of the content
 * repository given (a node address's, where there is one).
 */
export async function fetchNodeTypes(
  contentRepositoryId: string,
  include = '',
): Promise<NodeType[]> {
  return (
    await queryClient.fetchQuery(listingQuery(contentRepositoryId, include))
  ).data
}

/** The node type groups (Neos.Neos.nodeTypes.groups), for creation UIs. */
export function useNodeTypeGroups(enabled = true) {
  const contentRepositoryId = useActiveContentRepositoryId()
  const query = listingQuery(contentRepositoryId ?? '')
  return useQuery({
    ...query,
    queryFn:
      enabled && contentRepositoryId !== null ? query.queryFn : skipToken,
    select: (listing: NodeTypeListing) => listing.meta.groups,
  })
}

function loadNodeType(
  contentRepositoryId: string,
  name: string,
  signal?: AbortSignal,
): Promise<NodeType> {
  return unwrap(
    api.GET('/cr/{contentRepositoryId}/nodetypes/{nodeTypeName}', {
      params: { path: { contentRepositoryId, nodeTypeName: name } },
      signal,
    }),
  )
}

/** One node type with everything: its configuration, properties, references, constraints. */
export function useNodeType(name: string | null, enabled = true) {
  const contentRepositoryId = useActiveContentRepositoryId()
  return useQuery({
    queryKey: neosKeys.nodeTypes.nodeType(
      contentRepositoryId ?? '',
      name ?? '',
    ),
    queryFn:
      enabled && name !== null && contentRepositoryId !== null
        ? ({ signal }) => loadNodeType(contentRepositoryId, name, signal)
        : skipToken,
    staleTime: Infinity,
  })
}

/** Imperative variant of useNodeType, sharing its cache entries. */
export function fetchNodeType(
  contentRepositoryId: string,
  name: string,
): Promise<NodeType> {
  return queryClient.ensureQueryData({
    queryKey: neosKeys.nodeTypes.nodeType(contentRepositoryId, name),
    queryFn: ({ signal }) => loadNodeType(contentRepositoryId, name, signal),
    staleTime: Infinity,
  })
}

/**
 * The node type's configured label: Neos.Api falls back to the name for a node
 * type without one, which the shell rather humanizes itself.
 */
export function configuredLabel(nodeType: NodeType | undefined): string | null {
  if (!nodeType || nodeType.label === '' || nodeType.label === nodeType.name) {
    return null
  }
  return nodeType.label
}

/**
 * Whether a node type is (transitively) of the given super type, walking the
 * declared super types through the map.
 */
export function isOfType(
  map: NodeTypeMap,
  name: string,
  superTypeName: string,
): boolean {
  if (name === superTypeName) return true
  const seen = new Set<string>()
  const queue = [name]
  while (queue.length > 0) {
    const current = queue.pop()!
    if (seen.has(current)) continue
    seen.add(current)
    const nodeType = map.get(current)
    if (!nodeType) continue
    if (nodeType.superTypes.includes(superTypeName)) return true
    queue.push(...nodeType.superTypes)
  }
  return false
}

/**
 * Whether a node type matches a node type filter in Neos' NodeTypeCriteria
 * syntax ("Neos.Neos:Document", "Neos.Neos:Content,Neos.Neos:ContentCollection",
 * "!Neos.Neos:Document"): of one of the listed types (if any are listed) and
 * of none of the excluded ones.
 */
export function matchesNodeTypeFilter(
  map: NodeTypeMap,
  name: string,
  filter: string,
): boolean {
  const entries = filter
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
  const allowed = entries.filter((entry) => !entry.startsWith('!'))
  const excluded = entries
    .filter((entry) => entry.startsWith('!'))
    .map((entry) => entry.slice(1))
  if (excluded.some((type) => isOfType(map, name, type))) return false
  return (
    allowed.length === 0 || allowed.some((type) => isOfType(map, name, type))
  )
}
