import { useQuery } from '@tanstack/react-query'
import { queryClient } from '@/app/queryClient'
import { apiFetch, type Listing } from './client'
import { queryKeys } from './keys'
import { contentRepositoryPath } from './nodeAddress'

export interface NodeTypeDto {
  name: string
  abstract: boolean
  /** Declared (not transitive) super types. */
  superTypes: string[]
  /**
   * ui.label, already translated into the interface language by the server;
   * null if none is configured.
   */
  label: string | null
  /** ui.icon as Font Awesome classes ("fas fa-file"), null if none. */
  icon: string | null
  /** ui.group - only node types with a group are user-creatable (Neos convention). */
  group: string | null
  /** ui.position within the group. */
  position: string | number | null
}

export type NodeTypeMap = Map<string, NodeTypeDto>

/** A node type group (Neos.Neos.nodeTypes.groups): general, structure, ... */
export interface NodeTypeGroup {
  /** Translated label. */
  label?: string | null
  position?: string | number | null
  collapsed?: boolean
}

/** A node type as Neos.Api returns it (listNodeTypes / getNodeType). */
interface ApiNodeType {
  name: string
  /** Translated; the name if the node type has no label. */
  label: string
  icon: string | null
  isAbstract: boolean
  isFinal: boolean
  superTypes: string[]
  group: string | null
  position: string | number | null
  properties:
    { name: string; type: string | null; label: string | null }[] | null
  references:
    { name: string; label: string | null; maxItems: number | null }[] | null
  configuration: Record<string, unknown> | null
  allowedChildNodeTypes: string[] | null
  tetheredChildNodes:
    { name: string; nodeType: string; allowedChildNodeTypes: string[] }[] | null
}

interface ApiNodeTypeGroup {
  name: string
  label: string | null
  position: string | number | null
  collapsed: boolean
}

type ApiNodeTypeListing = Listing<
  ApiNodeType,
  { total: number; groups?: ApiNodeTypeGroup[] }
>

function nodeTypesPath(): string {
  return `${contentRepositoryPath()}/nodetypes`
}

function toNodeTypeDto(nodeType: ApiNodeType): NodeTypeDto {
  return {
    name: nodeType.name,
    abstract: nodeType.isAbstract,
    superTypes: nodeType.superTypes,
    // Neos.Api falls back to the name; the shell humanizes the name itself.
    label:
      nodeType.label !== '' && nodeType.label !== nodeType.name
        ? nodeType.label
        : null,
    icon: nodeType.icon,
    // ui.group with an unquoted numeric id may still arrive as a number -
    // normalize so it matches the (always string) group names.
    group: nodeType.group === null ? null : String(nodeType.group),
    position: nodeType.position,
  }
}

interface NodeTypesResponse {
  nodeTypes: NodeTypeDto[]
  groups: Record<string, NodeTypeGroup | null>
}

async function loadNodeTypes(): Promise<NodeTypesResponse> {
  const listing = await apiFetch<ApiNodeTypeListing>(nodeTypesPath())
  const groups: Record<string, NodeTypeGroup | null> = {}
  for (const group of listing.meta.groups ?? []) {
    groups[group.name] = {
      label: group.label,
      position: group.position,
      collapsed: group.collapsed,
    }
  }
  return { nodeTypes: listing.data.map(toNodeTypeDto), groups }
}

function toNodeTypeMap(data: NodeTypesResponse): NodeTypeMap {
  return new Map(data.nodeTypes.map((nt) => [nt.name, nt]))
}

export function useNodeTypes(enabled = true) {
  return useQuery({
    queryKey: queryKeys.nodeTypes.all,
    queryFn: loadNodeTypes,
    // The content model changes on deployments, not during a session.
    staleTime: Infinity,
    enabled,
    select: toNodeTypeMap,
  })
}

/** Imperative variant of useNodeTypes for non-hook contexts, same cache entry. */
export function fetchNodeTypeMap(): Promise<NodeTypeMap> {
  return queryClient
    .fetchQuery({
      queryKey: queryKeys.nodeTypes.all,
      queryFn: loadNodeTypes,
      staleTime: Infinity,
    })
    .then(toNodeTypeMap)
}

/** One merged property declaration as the include=properties listing carries it. */
export interface NodeTypePropertySummary {
  type: string | null
  /** Translated ui.label, if configured. */
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
      apiFetch<ApiNodeTypeListing>(
        `${nodeTypesPath()}?include=properties,references`,
      ),
    // The content model changes on deployments, not during a session.
    staleTime: Infinity,
    enabled,
    select: (listing): NodeTypeWithPropertiesMap =>
      new Map(
        listing.data.map((nt) => [
          nt.name,
          {
            ...toNodeTypeDto(nt),
            properties: Object.fromEntries(
              (nt.properties ?? []).map((property) => [
                property.name,
                { type: property.type, label: property.label },
              ]),
            ),
            references: Object.fromEntries(
              (nt.references ?? []).map((reference) => [
                reference.name,
                { label: reference.label, maxItems: reference.maxItems },
              ]),
            ),
          },
        ]),
      ),
  })
}

/** The group definitions from the same query, for creation UIs. */
export function useNodeTypeGroups(enabled = true) {
  return useQuery({
    queryKey: queryKeys.nodeTypes.all,
    queryFn: loadNodeTypes,
    staleTime: Infinity,
    enabled,
    select: (data) => data.groups,
  })
}

/**
 * What the content model allows below nodes of each node type: the
 * (non-abstract) node types a regular node may have as children, and per
 * tethered child node name the ones the tethered node may have.
 */
export interface ChildNodeConstraints {
  allowed: string[]
  tethered: Record<string, string[]>
}

/**
 * The child node constraints of every node type. Cached for the session - the
 * model changes on deployments only.
 */
export function fetchChildNodeConstraints(): Promise<
  Map<string, ChildNodeConstraints>
> {
  return queryClient.fetchQuery({
    queryKey: queryKeys.nodeTypes.childConstraints,
    queryFn: async () => {
      const listing = await apiFetch<ApiNodeTypeListing>(
        `${nodeTypesPath()}?include=allowedChildNodeTypes,tetheredChildNodes`,
      )
      return new Map(
        listing.data.map((nt): [string, ChildNodeConstraints] => [
          nt.name,
          {
            allowed: nt.allowedChildNodeTypes ?? [],
            tethered: Object.fromEntries(
              (nt.tetheredChildNodes ?? []).map((child) => [
                child.name,
                child.allowedChildNodeTypes,
              ]),
            ),
          },
        ]),
      )
    },
    staleTime: Infinity,
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
    /**
     * Integrator-written guidance for editors. The message arrives
     * translated into the interface language; `thumbnail` as configured.
     */
    help?: { message?: string | null; thumbnail?: string | null } | null
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
    queryFn: async (): Promise<NodeTypeSchemaDto> => {
      const nodeType = await apiFetch<ApiNodeType>(
        `${nodeTypesPath()}/${encodeURIComponent(name ?? '')}`,
      )
      return {
        name: nodeType.name,
        abstract: nodeType.isAbstract,
        superTypes: nodeType.superTypes,
        configuration: (nodeType.configuration ??
          {}) as NodeTypeSchemaDto['configuration'],
      }
    },
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
