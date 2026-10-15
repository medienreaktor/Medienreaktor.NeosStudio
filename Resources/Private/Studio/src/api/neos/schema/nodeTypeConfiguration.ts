import type { NodeType } from './index'

/**
 * The parts of a node type's configuration (NodeType.configuration, the
 * merged YAML with its super types) the shell reads. Neos.Api passes the
 * configuration on as it is, untyped; these are the shapes Neos documents for
 * it, so only what the inspector and the creation dialog consume is typed.
 */

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
    /**
     * Ask for the property (or reference) in the creation dialog, as an
     * element of its name - Neos' "promoted" creation dialog elements.
     */
    showInCreationDialog?: boolean
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

export interface NodeTypeConfiguration {
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
  options?: {
    /**
     * The node creation handlers by key (e.g. Flowpack.NodeTemplates'), which
     * the Studio's createNodeFromCreationDialog runs; null removes one.
     */
    nodeCreationHandlers?: Record<string, unknown> | null
  } | null
}

/** The configuration of a node type read with it (getNodeType), {} without. */
export function nodeTypeConfiguration(
  nodeType: Pick<NodeType, 'configuration'>,
): NodeTypeConfiguration {
  return (nodeType.configuration ?? {}) as NodeTypeConfiguration
}
