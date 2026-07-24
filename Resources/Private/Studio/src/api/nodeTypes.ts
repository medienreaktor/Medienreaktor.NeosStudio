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
  /** ui.group - only node types with a group are user-creatable (Neos convention). */
  group: string | null
  /** ui.position within the group. */
  position: string | number | null
}

export type NodeTypeMap = Map<string, NodeTypeDto>

/** A node type group (Neos.Neos.nodeTypes.groups): general, structure, ... */
export interface NodeTypeGroup {
  label?: string | null
  position?: string | number | null
  collapsed?: boolean
}

interface NodeTypesResponse {
  nodeTypes: NodeTypeDto[]
  groups: Record<string, NodeTypeGroup | null>
}

export function useNodeTypes(enabled = true) {
  return useQuery({
    queryKey: queryKeys.nodeTypes.all,
    queryFn: () => apiFetch<NodeTypesResponse>('/node-types'),
    // The content model changes on deployments, not during a session.
    staleTime: Infinity,
    enabled,
    // ui.group with an unquoted numeric id arrives as a number despite the
    // DTO type - normalize so it matches the (always string) keys of the
    // group definitions.
    select: (data): NodeTypeMap =>
      new Map(
        data.nodeTypes.map((nt) => [
          nt.name,
          { ...nt, group: nt.group === null ? null : String(nt.group) },
        ]),
      ),
  })
}

/** One merged property declaration as the ?includeProperties listing carries it. */
export interface NodeTypePropertySummary {
  type: string | null
  /** Untranslated ui.label id, if configured. */
  label: string | null
}

/** One merged reference declaration - maxItems 1 marks a singular reference. */
export interface NodeTypeReferenceSummary {
  label: string | null
  maxItems: number | null
}

export interface NodeTypeWithPropertiesDto extends NodeTypeDto {
  properties: Record<string, NodeTypePropertySummary>
  references: Record<string, NodeTypeReferenceSummary>
}

export type NodeTypeWithPropertiesMap = Map<string, NodeTypeWithPropertiesDto>

interface NodeTypesWithPropertiesResponse {
  nodeTypes: NodeTypeWithPropertiesDto[]
  groups: Record<string, NodeTypeGroup | null>
}

/**
 * The full content model: every node type with its merged property and
 * reference declarations - what the Content Model graph renders. Separate
 * query (and key) from useNodeTypes so the lean listing every other consumer
 * boots with stays small.
 */
export function useNodeTypesWithProperties(enabled = true) {
  return useQuery({
    queryKey: queryKeys.nodeTypes.withProperties,
    queryFn: () =>
      apiFetch<NodeTypesWithPropertiesResponse>(
        '/node-types?includeProperties=1',
      ),
    // The content model changes on deployments, not during a session.
    staleTime: Infinity,
    enabled,
    select: (data): NodeTypeWithPropertiesMap =>
      new Map(
        data.nodeTypes.map((nt) => [
          nt.name,
          {
            ...nt,
            // Same unquoted-YAML-scalar normalization as useNodeTypes.
            group: nt.group === null ? null : String(nt.group),
            properties: nt.properties ?? {},
            references: nt.references ?? {},
          },
        ]),
      ),
  })
}

/** The group definitions from the same query, for creation UIs. */
export function useNodeTypeGroups(enabled = true) {
  return useQuery({
    queryKey: queryKeys.nodeTypes.all,
    queryFn: () => apiFetch<NodeTypesResponse>('/node-types'),
    staleTime: Infinity,
    enabled,
    select: (data) => data.groups ?? {},
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
  /**
   * Defaults to the "default" tab when omitted. An unquoted numeric id in the
   * YAML arrives as a number (PHP preserves the scalar type), as it does for
   * the group references below.
   */
  tab?: string | number
  position?: string | number
  collapsed?: boolean
}

export interface PropertyInspectorConfig {
  group?: string | number
  position?: string | number
  editor?: string
  editorOptions?: Record<string, unknown>
  /** True, or a "ClientEval:..." expression evaluated in the browser (see features/inspector/clientEval.ts). */
  hidden?: boolean | string
}

/**
 * One entry of a node type's ui.inspector.views - a read-only widget shown
 * between the properties of its group (e.g. the data-source-backed
 * Table/Column/TimeSeries views, or the node info view).
 */
export interface InspectorViewConfig {
  /** The view identifier, e.g. "Neos.Neos/Inspector/Views/Data/TableView". */
  view?: string
  label?: string | null
  group?: string | number
  position?: string | number
  viewOptions?: Record<string, unknown>
  /** True, or a "ClientEval:..." expression, like a property's hidden flag. */
  hidden?: boolean | string
}

/**
 * How far a property write reaches across dimension variants: only the edited
 * variant ("node", the default), the variant and its specializations, or every
 * variant of the aggregate ("nodeAggregate" - the value is effectively shared
 * across all dimensions).
 */
export type PropertyScope = 'node' | 'specializations' | 'nodeAggregate'

export interface PropertyConfig {
  type?: string
  defaultValue?: unknown
  scope?: PropertyScope
  /** Reference declarations only: maxItems 1 marks a singular reference. */
  constraints?: { maxItems?: number | null } | null
  /** Validator identifier -> options, e.g. "Neos.Neos/Validation/NotEmptyValidator": []. */
  validation?: Record<string, unknown> | null
  ui?: {
    label?: string | null
    reloadIfChanged?: boolean
    reloadPageIfChanged?: boolean
    inlineEditable?: boolean
    inspector?: PropertyInspectorConfig | null
  } | null
}

/**
 * One element of a node type's ui.creationDialog - a value asked from the
 * editor before the node is created.
 */
export interface CreationDialogElementConfig {
  type?: string
  defaultValue?: unknown
  position?: string | number
  ui?: {
    label?: string | null
    hidden?: boolean
    editor?: string
    editorOptions?: Record<string, unknown>
  } | null
  validation?: Record<string, unknown> | null
}

/**
 * The full (merged, supertypes included) configuration of one node type -
 * only the parts the inspector and the creation dialog consume are typed.
 */
export interface NodeTypeSchemaDto {
  name: string
  abstract: boolean
  superTypes: string[]
  configuration: {
    ui?: {
      label?: string | null
      creationDialog?: {
        elements?: Record<string, CreationDialogElementConfig | null>
      } | null
      inspector?: {
        tabs?: Record<string, InspectorTabConfig | null>
        groups?: Record<string, InspectorGroupConfig | null>
        views?: Record<string, InspectorViewConfig | null>
      } | null
    } | null
    properties?: Record<string, PropertyConfig | null>
    /**
     * Reference declarations. Neos 9 separates them from properties in the
     * node type model - legacy `type: reference(s)` property declarations
     * arrive here too (the core migrates them, marking singular ones with
     * constraints.maxItems = 1 and stripping the type).
     */
    references?: Record<string, PropertyConfig | null>
  }
}

export function useNodeTypeSchema(name: string | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.nodeTypes.schema(name ?? ''),
    queryFn: () =>
      apiFetch<NodeTypeSchemaDto>(
        `/node-types/${encodeURIComponent(name ?? '')}`,
      ),
    // The content model changes on deployments, not during a session.
    staleTime: Infinity,
    enabled: enabled && name !== null,
  })
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
