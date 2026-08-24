import type {
  InspectorGroupConfig,
  InspectorTabConfig,
  InspectorViewConfig,
  NodeTypeSchemaDto,
  PropertyConfig,
  PropertyScope,
} from '@/api/nodeTypes'
import { translateLabel } from '@/lib/i18n'
import { sortByPosition } from '@/lib/positional'

export interface InspectorProperty {
  name: string
  /** The property type from the node type configuration, e.g. "string". */
  type: string
  label: string
  /** Resolved editor identifier, e.g. "Neos.Neos/Inspector/Editors/TextFieldEditor". */
  editor: string | null
  editorOptions: Record<string, unknown>
  /**
   * ui.inspector.hidden, as configured: true, or a "ClientEval:..."
   * expression - evaluated per node before rendering (see clientEval.ts).
   */
  hidden: boolean | string
  /** Any non-"node" scope makes edits span dimension variants - flagged next to the label. */
  scope: PropertyScope
  /**
   * The property's validation block: validator identifier -> options,
   * run through the validator registry (see validators/registry.ts).
   * Empty when the property configures no validation.
   */
  validation: Record<string, unknown>
  /**
   * How the preview refreshes after this property is saved:
   * ui.reloadPageIfChanged reloads the whole page ('page'),
   * ui.reloadIfChanged re-renders just the node's element out-of-band
   * ('element'), and with neither flag the preview is left alone ('none') -
   * the change does not affect the rendered output.
   */
  reload: 'none' | 'element' | 'page'
  /** ui.help, resolved: null unless a message or thumbnail actually renders. */
  help: InspectorPropertyHelp | null
}

/** Resolved ui.help content - shown in a popover next to the property label. */
export interface InspectorPropertyHelp {
  message: string | null
  thumbnail: string | null
}

/**
 * A read-only inspector view (ui.inspector.views entry) placed between the
 * properties of its group - e.g. the data-source-backed widgets.
 */
export interface InspectorView {
  name: string
  label: string
  /** Resolved view identifier, e.g. "Neos.Neos/Inspector/Views/Data/TableView". */
  view: string | null
  viewOptions: Record<string, unknown>
  /** ui.inspector.views.*.hidden: true, or a "ClientEval:..." expression. */
  hidden: boolean | string
}

/** One group entry, in configured position order: an editable property or a view. */
export type InspectorItem =
  | { kind: 'property'; property: InspectorProperty }
  | { kind: 'view'; view: InspectorView }

export interface InspectorGroup {
  id: string
  label: string
  icon: string | null
  collapsed: boolean
  items: InspectorItem[]
}

export interface InspectorTab {
  id: string
  label: string
  icon: string | null
  groups: InspectorGroup[]
}

/**
 * Labels in node type configuration are almost always untranslated XLIFF ids
 * ("Neos.Seo:NodeTypes.SeoMetaTagsMixin:properties.metaDescription") or the
 * magic value "i18n". Id-shaped labels resolve against the XLIFF bundle
 * (loaded at boot, see lib/i18n.ts); anything untranslatable falls back to a
 * humanized key: "metaDescription" -> "Meta description".
 *
 * Keys sourced from configuration values (group/tab ids, select values) can
 * arrive as numbers or booleans when the YAML leaves them unquoted - PHP
 * preserves the scalar type through json_encode.
 */
export function humanizeLabel(
  label: string | null | undefined,
  key: string | number,
): string {
  if (label && label !== 'i18n') {
    if (!looksLikeI18nId(label)) return label
    const translated = translateLabel(label)
    if (translated !== null) return translated
  }
  const words = String(key)
    .replace(/^_/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function looksLikeI18nId(label: string): boolean {
  // "Vendor.Package:Source:key.path" - two colons, no spaces.
  return /^[\w.]+:[\w.-]+:[\w.-]+$/.test(label)
}

/**
 * A group/tab id referenced from a configuration value, normalized to a
 * string. The configured groups/tabs maps are JSON objects whose keys are
 * always strings, but an unquoted numeric id on the referencing side
 * ("group: 123") arrives as a number - without normalization the two sides
 * never meet, and the raw number later crashes humanizeLabel's fallback.
 */
function configKey(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null
  return String(value)
}

/** A plain (or translated) editor option; an untranslatable i18n id is worse than none - drop it. */
export function plainEditorOption(
  options: Record<string, unknown>,
  name: string,
): string | undefined {
  const value = options[name]
  if (typeof value !== 'string' || value === '') return undefined
  if (looksLikeI18nId(value)) return translateLabel(value) ?? undefined
  return value
}

/**
 * Resolves a property's ui.help block. The server already expanded
 * `message: i18n` to a full XLIFF id, so all that is left is translating it -
 * an id the bundle cannot resolve is dropped, as showing the raw id would be
 * worse than no help. Thumbnails arrive as configured (the server-side
 * enrichment resolves resource:// URIs only for node-type-level help, not
 * per property), so a resource:// URI is rewritten to its published static
 * URL here, like the classic UI's EditorEnvelope does. Returns null when
 * nothing renderable remains, so callers can gate the affordance on it.
 */
function resolveHelp(
  help:
    { message?: string | null; thumbnail?: string | null } | null | undefined,
): InspectorPropertyHelp | null {
  let message = help?.message || null
  if (message !== null && looksLikeI18nId(message)) {
    message = translateLabel(message)
  }
  const thumbnail = resolveResourceUri(help?.thumbnail || null)
  if (message === null && thumbnail === null) return null
  return { message, thumbnail }
}

/**
 * Rewrites a resource:// URI to the published static resource URL. Flow
 * publishes a package's Resources/Public/ directory to
 * /_Resources/Static/Packages/<PackageKey>/ - the "Public" segment is
 * stripped, so both the proper Flow form
 * (resource://Vendor.Package/Public/Images/x.png) and the classic UI's
 * quirky one without the Public segment map to the same URL.
 */
function resolveResourceUri(uri: string | null): string | null {
  if (uri === null || !uri.startsWith('resource://')) return uri
  const match = /^resource:\/\/([^/]+)\/(?:Public\/)?(.+)$/.exec(uri)
  if (!match) return null
  return `/_Resources/Static/Packages/${match[1]}/${match[2]}`
}

/**
 * Default editors per property type, mirroring the relevant entries of the
 * Neos.Neos.userInterface.inspector.dataTypes settings. Only consulted when a
 * property does not configure ui.inspector.editor itself.
 */
const DATA_TYPE_EDITORS: Record<string, string> = {
  string: 'Neos.Neos/Inspector/Editors/TextFieldEditor',
  integer: 'Neos.Neos/Inspector/Editors/TextFieldEditor',
  boolean: 'Neos.Neos/Inspector/Editors/BooleanEditor',
  array: 'Neos.Neos/Inspector/Editors/SelectBoxEditor',
  DateTime: 'Neos.Neos/Inspector/Editors/DateTimeEditor',
  reference: 'Neos.Neos/Inspector/Editors/ReferenceEditor',
  references: 'Neos.Neos/Inspector/Editors/ReferencesEditor',
  'Neos\\Media\\Domain\\Model\\ImageInterface':
    'Neos.Neos/Inspector/Editors/ImageEditor',
  'Neos\\Media\\Domain\\Model\\Asset':
    'Neos.Neos/Inspector/Editors/AssetEditor',
}

/** The editor a property of this type gets when it configures none itself, or null if the type has no default. */
export function defaultEditorForType(type: string): string | null {
  return DATA_TYPE_EDITORS[type] ?? null
}

/**
 * Default editor options per property type, applied when the property keeps
 * its type's default editor (mirroring how the dataTypes settings merge in
 * Neos): array properties are a multi-select unless configured otherwise.
 */
const DATA_TYPE_EDITOR_OPTIONS: Record<string, Record<string, unknown>> = {
  array: { multiple: true },
}

/**
 * Builds the inspector structure for one node type: tabs containing groups
 * containing items (editable properties and read-only views, interleaved by
 * their configured position - the old UI's ordering), each level sorted by
 * position. Only properties/views assigned to a group appear (the Neos rule
 * for inspector visibility); groups without items and tabs without groups are
 * dropped.
 */
export function buildInspectorSchema(
  schema: NodeTypeSchemaDto,
): InspectorTab[] {
  const properties = schema.configuration.properties ?? {}
  const references = schema.configuration.references ?? {}
  const tabsConfig = schema.configuration.ui?.inspector?.tabs ?? {}
  const groupsConfig = schema.configuration.ui?.inspector?.groups ?? {}
  const viewsConfig = schema.configuration.ui?.inspector?.views ?? {}

  const propertiesByGroup = new Map<
    string,
    { name: string; config: PropertyConfig }[]
  >()
  for (const [name, config] of Object.entries(properties)) {
    const group = configKey(config?.ui?.inspector?.group)
    if (!group) continue
    if (!propertiesByGroup.has(group)) propertiesByGroup.set(group, [])
    propertiesByGroup.get(group)!.push({ name, config: config ?? {} })
  }
  // References live in their own configuration section in Neos 9 (the core
  // even migrates legacy `type: reference(s)` properties there), but the
  // inspector treats them as properties like the classic UI does. Synthesize
  // the type the editor mapping keys on: constraints.maxItems 1 = singular.
  for (const [name, config] of Object.entries(references)) {
    const group = configKey(config?.ui?.inspector?.group)
    if (!group) continue
    if (!propertiesByGroup.has(group)) propertiesByGroup.set(group, [])
    propertiesByGroup.get(group)!.push({
      name,
      config: {
        ...config,
        type: config?.constraints?.maxItems === 1 ? 'reference' : 'references',
      },
    })
  }

  const viewsByGroup = new Map<
    string,
    { name: string; config: InspectorViewConfig }[]
  >()
  for (const [name, config] of Object.entries(viewsConfig)) {
    const group = configKey(config?.group)
    if (!group) continue
    if (!viewsByGroup.has(group)) viewsByGroup.set(group, [])
    viewsByGroup.get(group)!.push({ name, config: config ?? {} })
  }

  // Groups referenced by a property or view but never configured still render.
  const groupIds = new Set([
    ...Object.keys(groupsConfig),
    ...propertiesByGroup.keys(),
    ...viewsByGroup.keys(),
  ])
  const groupsByTab = new Map<string, InspectorGroup[]>()
  const orderedGroupIds = sortByPosition(
    [...groupIds].map((id) => ({
      key: id,
      position: groupsConfig[id]?.position,
    })),
  )
  for (const groupId of orderedGroupIds) {
    const config: InspectorGroupConfig = groupsConfig[groupId] ?? {}
    const groupProperties = propertiesByGroup.get(groupId) ?? []
    const groupViews = viewsByGroup.get(groupId) ?? []
    if (groupProperties.length === 0 && groupViews.length === 0) continue

    // Properties and views share one position space within the group (the
    // old UI's items list); "before/after <name>" references work across both.
    // A view named like a property is shadowed by it (names key the list).
    const orderedItems = [
      ...new Set(
        sortByPosition([
          ...groupProperties.map((p) => ({
            key: p.name,
            position: p.config.ui?.inspector?.position,
          })),
          ...groupViews.map((v) => ({
            key: v.name,
            position: v.config.position,
          })),
        ]),
      ),
    ].map((name): InspectorItem => {
      const property = groupProperties.find((p) => p.name === name)
      if (property) {
        const propertyConfig = property.config
        const type = propertyConfig.type ?? 'string'
        const defaultEditor = DATA_TYPE_EDITORS[type] ?? null
        const editor = propertyConfig.ui?.inspector?.editor ?? defaultEditor
        return {
          kind: 'property',
          property: {
            name,
            type,
            label: humanizeLabel(propertyConfig.ui?.label, name),
            editor,
            hidden: propertyConfig.ui?.inspector?.hidden ?? false,
            scope: propertyConfig.scope ?? 'node',
            validation: propertyConfig.validation ?? {},
            help: resolveHelp(propertyConfig.ui?.help),
            reload: propertyConfig.ui?.reloadPageIfChanged
              ? 'page'
              : propertyConfig.ui?.reloadIfChanged
                ? 'element'
                : 'none',
            editorOptions: {
              ...(editor === defaultEditor
                ? DATA_TYPE_EDITOR_OPTIONS[type]
                : undefined),
              ...propertyConfig.ui?.inspector?.editorOptions,
            },
          },
        }
      }
      const viewConfig = groupViews.find((v) => v.name === name)!.config
      return {
        kind: 'view',
        view: {
          name,
          label: humanizeLabel(viewConfig.label, name),
          view: viewConfig.view ?? null,
          viewOptions: viewConfig.viewOptions ?? {},
          hidden: viewConfig.hidden ?? false,
        },
      }
    })

    const tabId = configKey(config.tab) ?? 'default'
    if (!groupsByTab.has(tabId)) groupsByTab.set(tabId, [])
    groupsByTab.get(tabId)!.push({
      id: groupId,
      label: humanizeLabel(config.label, groupId),
      icon: config.icon ?? null,
      collapsed: config.collapsed ?? false,
      items: orderedItems,
    })
  }

  const tabIds = new Set([...Object.keys(tabsConfig), ...groupsByTab.keys()])
  return sortByPosition(
    [...tabIds].map((id) => ({ key: id, position: tabsConfig[id]?.position })),
  )
    .filter((tabId) => (groupsByTab.get(tabId) ?? []).length > 0)
    .map((tabId): InspectorTab => {
      const config: InspectorTabConfig = tabsConfig[tabId] ?? {}
      return {
        id: tabId,
        label: humanizeLabel(config.label, tabId),
        icon: config.icon ?? null,
        groups: groupsByTab.get(tabId)!,
      }
    })
}
