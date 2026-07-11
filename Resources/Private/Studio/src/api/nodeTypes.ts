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
    queryKey: queryKeys.nodeTypes.all,
    queryFn: () => apiFetch<{ nodeTypes: NodeTypeDto[] }>('/nodetypes'),
    // The content model changes on deployments, not during a session.
    staleTime: Infinity,
    enabled,
    select: (data): NodeTypeMap => new Map(data.nodeTypes.map((nt) => [nt.name, nt])),
  })
}

export interface InspectorTabConfig {
  label?: string | null
  icon?: string | null
  position?: string | number
}

export interface InspectorGroupConfig {
  label?: string | null
  icon?: string | null
  /** Defaults to the "default" tab when omitted. */
  tab?: string
  position?: string | number
  collapsed?: boolean
}

export interface PropertyInspectorConfig {
  group?: string
  position?: string | number
  editor?: string
  editorOptions?: Record<string, unknown>
}

export interface PropertyConfig {
  type?: string
  defaultValue?: unknown
  ui?: {
    label?: string | null
    reloadIfChanged?: boolean
    reloadPageIfChanged?: boolean
    inlineEditable?: boolean
    inspector?: PropertyInspectorConfig | null
  } | null
}

/**
 * The full (merged, supertypes included) configuration of one node type -
 * only the parts the inspector consumes are typed.
 */
export interface NodeTypeSchemaDto {
  name: string
  abstract: boolean
  superTypes: string[]
  configuration: {
    ui?: {
      label?: string | null
      inspector?: {
        tabs?: Record<string, InspectorTabConfig | null>
        groups?: Record<string, InspectorGroupConfig | null>
      } | null
    } | null
    properties?: Record<string, PropertyConfig | null>
  }
}

export function useNodeTypeSchema(name: string | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.nodeTypes.schema(name ?? ''),
    queryFn: () => apiFetch<NodeTypeSchemaDto>(`/nodetypes/${encodeURIComponent(name ?? '')}`),
    // The content model changes on deployments, not during a session.
    staleTime: Infinity,
    enabled: enabled && name !== null,
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
