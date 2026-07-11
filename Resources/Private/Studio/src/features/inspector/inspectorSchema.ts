import type {
  InspectorGroupConfig,
  InspectorTabConfig,
  NodeTypeSchemaDto,
  PropertyConfig,
} from '@/api/nodeTypes'
import { sortByPosition } from '@/lib/positional'

export interface InspectorProperty {
  name: string
  /** The property type from the node type configuration, e.g. "string". */
  type: string
  label: string
  /** Resolved editor identifier, e.g. "Neos.Neos/Inspector/Editors/TextFieldEditor". */
  editor: string | null
  editorOptions: Record<string, unknown>
}

export interface InspectorGroup {
  id: string
  label: string
  icon: string | null
  collapsed: boolean
  properties: InspectorProperty[]
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
 * magic value "i18n". Studio has no translation endpoint yet, so anything
 * id-shaped falls back to a humanized key: "metaDescription" -> "Meta
 * description".
 */
export function humanizeLabel(label: string | null | undefined, key: string): string {
  if (label && label !== 'i18n' && !looksLikeI18nId(label)) return label
  const words = key
    .replace(/^_/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function looksLikeI18nId(label: string): boolean {
  // "Vendor.Package:Source:key.path" - two colons, no spaces.
  return /^[\w.]+:[\w.-]+:[\w.-]+$/.test(label)
}

/** An i18n-id placeholder is worse than none - drop it. */
export function plainEditorOption(options: Record<string, unknown>, name: string): string | undefined {
  const value = options[name]
  if (typeof value !== 'string' || value === '' || looksLikeI18nId(value)) return undefined
  return value
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
  DateTime: 'Neos.Neos/Inspector/Editors/DateTimeEditor',
  reference: 'Neos.Neos/Inspector/Editors/ReferenceEditor',
  references: 'Neos.Neos/Inspector/Editors/ReferencesEditor',
}

/**
 * Builds the inspector structure for one node type: tabs containing groups
 * containing properties, each level sorted by its configured position. Only
 * properties assigned to a group appear (the Neos rule for inspector
 * visibility); groups without properties and tabs without groups are dropped.
 */
export function buildInspectorSchema(schema: NodeTypeSchemaDto): InspectorTab[] {
  const properties = schema.configuration.properties ?? {}
  const tabsConfig = schema.configuration.ui?.inspector?.tabs ?? {}
  const groupsConfig = schema.configuration.ui?.inspector?.groups ?? {}

  const propertiesByGroup = new Map<string, { name: string; config: PropertyConfig }[]>()
  for (const [name, config] of Object.entries(properties)) {
    const group = config?.ui?.inspector?.group
    if (!group) continue
    if (!propertiesByGroup.has(group)) propertiesByGroup.set(group, [])
    propertiesByGroup.get(group)!.push({ name, config: config ?? {} })
  }

  // Groups referenced by a property but never configured still render.
  const groupIds = new Set([...Object.keys(groupsConfig), ...propertiesByGroup.keys()])
  const groupsByTab = new Map<string, InspectorGroup[]>()
  const orderedGroupIds = sortByPosition(
    [...groupIds].map((id) => ({ key: id, position: groupsConfig[id]?.position })),
  )
  for (const groupId of orderedGroupIds) {
    const config: InspectorGroupConfig = groupsConfig[groupId] ?? {}
    const groupProperties = propertiesByGroup.get(groupId) ?? []
    if (groupProperties.length === 0) continue

    const orderedProperties = sortByPosition(
      groupProperties.map((p) => ({ key: p.name, position: p.config.ui?.inspector?.position })),
    ).map((name): InspectorProperty => {
      const propertyConfig = groupProperties.find((p) => p.name === name)!.config
      const type = propertyConfig.type ?? 'string'
      return {
        name,
        type,
        label: humanizeLabel(propertyConfig.ui?.label, name),
        editor: propertyConfig.ui?.inspector?.editor ?? DATA_TYPE_EDITORS[type] ?? null,
        editorOptions: propertyConfig.ui?.inspector?.editorOptions ?? {},
      }
    })

    const tabId = config.tab ?? 'default'
    if (!groupsByTab.has(tabId)) groupsByTab.set(tabId, [])
    groupsByTab.get(tabId)!.push({
      id: groupId,
      label: humanizeLabel(config.label, groupId),
      icon: config.icon ?? null,
      collapsed: config.collapsed ?? false,
      properties: orderedProperties,
    })
  }

  const tabIds = new Set([...Object.keys(tabsConfig), ...groupsByTab.keys()])
  return sortByPosition([...tabIds].map((id) => ({ key: id, position: tabsConfig[id]?.position })))
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
