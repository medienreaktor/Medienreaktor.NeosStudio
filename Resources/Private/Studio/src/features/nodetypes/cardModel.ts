import {
  isOfType,
  type NodeTypeWithPropertiesDto,
  type NodeTypeWithPropertiesMap,
} from '@/api/nodeTypes'
import { DOCUMENT_NODE_TYPE } from '@/api/nodes'
import { translateLabel } from '@/lib/i18n'

/**
 * Turns the raw node type listing (merged property/reference declarations
 * per type) into the card models the Node Types graph renders: display
 * label, a coarse kind for color coding, and every property/reference split
 * into "declared here" versus "inherited" (with the nearest ancestor that
 * declares it).
 */

export type CardKind = 'document' | 'content' | 'collection' | 'other'

export interface CardRow {
  name: string
  /** Short display type ("string", "ImageInterface", "reference"). */
  type: string
  /** The nearest supertype declaring this row - null on own rows. */
  inheritedFrom: string | null
  isReference: boolean
}

export interface CardModel {
  name: string
  label: string
  abstract: boolean
  icon: string | null
  kind: CardKind
  /** Declared super types that exist in the map (the graph's edges). */
  superTypes: string[]
  ownRows: CardRow[]
  inheritedRows: CardRow[]
}

/** Strip namespaces from PHP class types: array<Neos\...\Asset> → array<Asset>. */
export function shortPropertyType(type: string | null): string {
  if (!type) return 'mixed'
  return type.replace(/[A-Za-z0-9_]+(?:\\[A-Za-z0-9_]+)+/g, (qualified) =>
    qualified.split('\\').pop()!,
  )
}

/** The translated ui.label, or the name's tail ("Vendor:Content.Text" → "Content.Text"). */
function displayLabel(nodeType: NodeTypeWithPropertiesDto): string {
  const translated = nodeType.label ? translateLabel(nodeType.label) : null
  if (translated) return translated
  return nodeType.name.split(':').pop() || nodeType.name
}

function kindOf(map: NodeTypeWithPropertiesMap, name: string): CardKind {
  if (isOfType(map, name, DOCUMENT_NODE_TYPE)) return 'document'
  if (isOfType(map, name, 'Neos.Neos:ContentCollection')) return 'collection'
  if (isOfType(map, name, 'Neos.Neos:Content')) return 'content'
  return 'other'
}

/** The merged declaration map (properties or references) the row came from. */
type DeclarationsOf = (
  nodeType: NodeTypeWithPropertiesDto,
) => Record<string, unknown>

/**
 * The nearest ancestor of `name` (which itself carries `key` in its merged
 * map) that declares `key` - i.e. the highest card the row would be an own
 * row on. Declared super types are searched in order, mirroring how the CR
 * merges configuration.
 */
function originOf(
  map: NodeTypeWithPropertiesMap,
  name: string,
  key: string,
  declarationsOf: DeclarationsOf,
): string {
  const nodeType = map.get(name)
  if (!nodeType) return name
  const declaringParent = nodeType.superTypes.find((superType) => {
    const parent = map.get(superType)
    return parent !== undefined && key in declarationsOf(parent)
  })
  return declaringParent === undefined
    ? name
    : originOf(map, declaringParent, key, declarationsOf)
}

export function buildCardModels(map: NodeTypeWithPropertiesMap): CardModel[] {
  const models: CardModel[] = []
  for (const nodeType of map.values()) {
    const knownSuperTypes = nodeType.superTypes.filter((superType) =>
      map.has(superType),
    )
    const ownRows: CardRow[] = []
    const inheritedRows: CardRow[] = []

    const add = (
      key: string,
      type: string,
      isReference: boolean,
      declarationsOf: DeclarationsOf,
    ) => {
      // Present in a direct supertype's merged map = inherited; the origin
      // walk then names the ancestor that actually declares it.
      const declaringParent = knownSuperTypes.find(
        (superType) => key in declarationsOf(map.get(superType)!),
      )
      if (declaringParent === undefined) {
        ownRows.push({ name: key, type, inheritedFrom: null, isReference })
      } else {
        inheritedRows.push({
          name: key,
          type,
          inheritedFrom: originOf(map, declaringParent, key, declarationsOf),
          isReference,
        })
      }
    }

    for (const [key, property] of Object.entries(nodeType.properties)) {
      add(
        key,
        shortPropertyType(property?.type ?? null),
        false,
        (nt) => nt.properties,
      )
    }
    for (const [key, reference] of Object.entries(nodeType.references)) {
      add(
        key,
        reference?.maxItems === 1 ? 'reference' : 'references',
        true,
        (nt) => nt.references,
      )
    }

    models.push({
      name: nodeType.name,
      label: displayLabel(nodeType),
      abstract: nodeType.abstract,
      icon: nodeType.icon,
      kind: kindOf(map, nodeType.name),
      superTypes: knownSuperTypes,
      ownRows,
      inheritedRows,
    })
  }
  return models
}
