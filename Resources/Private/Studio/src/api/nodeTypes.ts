import { useQuery } from '@tanstack/react-query'
import { apiFetch } from './client'
import { queryKeys } from './keys'

export interface NodeTypeDto {
  name: string
  abstract: boolean
  /** Declared (not transitive) super types. */
  superTypes: string[]
  /** Untranslated ui.label id, if configured. */
  label: string | null
  /** ui.icon as configured - a Font Awesome name by Neos convention. */
  icon: string | null
}

export type NodeTypeMap = Map<string, NodeTypeDto>

export function useNodeTypes(enabled = true) {
  return useQuery({
    queryKey: queryKeys.nodeTypes,
    queryFn: () => apiFetch<{ nodeTypes: NodeTypeDto[] }>('/nodetypes'),
    // The content model changes on deployments, not during a session.
    staleTime: Infinity,
    enabled,
    select: (data): NodeTypeMap => new Map(data.nodeTypes.map((nt) => [nt.name, nt])),
  })
}

/**
 * Whether a node type is (transitively) of the given super type, walking the
 * declared super types through the map.
 */
export function isOfType(map: NodeTypeMap, name: string, superTypeName: string): boolean {
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
