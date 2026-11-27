import type { Asset, NodeAddress } from '@/api/neos/schema'
import { referenceIdentifier } from '../../../api/neos/endpoints/assetReference.ts'
import { dataSourceSelectOptions } from '../../../api/neos/endpoints/dataSourceOptions.ts'
import { parseAssetUri, parseDocumentUri } from '../../links/linkValue.ts'
import { parseIso, phpFormat } from '../../../lib/phpDate.ts'
import type {
  FormattedValue,
  PropertyEditorDefinition,
  ValueFormatContext,
} from './registry'

export type ValueFormatter = NonNullable<
  PropertyEditorDefinition['formatValue']
>

/** What a looked-up node needs for a label. */
export interface LabelledNode {
  nodeAggregateId: string
  label: string
}

/**
 * What the built-in formatters look values up with - injected, so the shell
 * binds them to its query client and tests to fakes.
 */
export interface ValueFormatServices {
  /** An editor option as the editors read it: plain, or translated when an i18n id. */
  option: (options: Record<string, unknown>, name: string) => string | undefined
  /** A configured label (translated when an i18n id), or the humanized key. */
  humanizeLabel: (label: string | null | undefined, key: string) => string
  /** The subgraph lookups use when there is no edited node. */
  fallbackSubgraph: () => NodeAddress | null
  /** The nodes in the subgraph of the address; null for an id that does not resolve. */
  resolveNodes: (
    subgraph: NodeAddress,
    ids: string[],
  ) => Promise<Map<string, LabelledNode | null>>
  /** A Media Library asset; null when it is gone. */
  fetchAsset: (id: string) => Promise<Asset | null>
  /** A data source's raw result, as the select box editor loads it. */
  fetchDataSource: (params: {
    identifier: string
    node: NodeAddress | undefined
    additionalData: Record<string, unknown> | undefined
    disableCaching: boolean
  }) => Promise<unknown>
  /** A node type's label, null for an unknown type. */
  nodeTypeLabel: (
    contentRepositoryId: string,
    name: string,
  ) => Promise<string | null>
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** Markup as its text, on one line. */
export function stripMarkup(html: string): string {
  return oneLine(
    html
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6])\b[^>]*>/gi, ' ')
      .replace(/<[^>]*>/g, '')
      .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
        if (name.startsWith('#')) {
          const hex = name[1] === 'x' || name[1] === 'X'
          const codePoint = parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10)
          return codePoint <= 0x10ffff
            ? String.fromCodePoint(codePoint)
            : entity
        }
        return ENTITIES[name.toLowerCase()] ?? entity
      }),
  )
}

function labelOrNull(text: string): FormattedValue | null {
  return text === '' ? null : { label: text }
}

function scalarText(value: unknown): string | null {
  if (typeof value === 'string') {
    return /<[a-z!/][^>]*>/i.test(value) ? stripMarkup(value) : oneLine(value)
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return null
}

/**
 * The value without an editor's help: strings as they are (markup stripped),
 * numbers and booleans stringified, lists of those joined.
 */
export function plainFormattedValue(value: unknown): FormattedValue | null {
  if (Array.isArray(value)) {
    return labelOrNull(
      value
        .map(scalarText)
        .filter((text): text is string => text !== null && text !== '')
        .join(', '),
    )
  }
  const text = scalarText(value)
  return text === null ? null : labelOrNull(text)
}

/**
 * The option key of a stored select box value, as its options are keyed:
 * scalars as strings, objects as their JSON. Null for no value.
 */
export function selectValueKey(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function selectKeys(value: unknown): string[] {
  const keys = Array.isArray(value)
    ? value.map(selectValueKey)
    : [selectValueKey(value)]
  return keys.filter((key): key is string => key !== null)
}

/** The ids a reference value names: an id, a list of them, or nodes. */
function referenceIds(value: unknown): string[] {
  const idOf = (item: unknown): string | null => {
    if (typeof item === 'string') return item === '' ? null : item
    if (item && typeof item === 'object') {
      const record = item as Record<string, unknown>
      const id = record.nodeAggregateId ?? record.id
      return typeof id === 'string' && id !== '' ? id : null
    }
    return null
  }
  return (Array.isArray(value) ? value : [value])
    .map(idOf)
    .filter((id): id is string => id !== null)
}

function joined(parts: FormattedValue[]): FormattedValue | null {
  if (parts.length === 0) return null
  const label = parts.map((part) => part.label).join(', ')
  return parts.some((part) => part.missing)
    ? { label, missing: true }
    : { label }
}

function objectOption(
  options: Record<string, unknown>,
  name: string,
): Record<string, unknown> | undefined {
  const value = options[name]
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

const labelMaps = new WeakMap<object, Map<string, string>>()

/** A data source result's labels by option key - one map per (cached) result. */
function dataSourceLabels(data: unknown): Map<string, string> {
  if (data === null || typeof data !== 'object') return new Map()
  let labels = labelMaps.get(data)
  if (!labels) {
    labels = new Map(
      dataSourceSelectOptions(data).map((option) => [option.key, option.label]),
    )
    labelMaps.set(data, labels)
  }
  return labels
}

export function createValueFormatters(services: ValueFormatServices) {
  const subgraphOf = (context: ValueFormatContext): NodeAddress | null =>
    context.nodeAddress ?? services.fallbackSubgraph()

  const nodeLabels = async (
    ids: string[],
    context: ValueFormatContext,
  ): Promise<FormattedValue[]> => {
    const subgraph = subgraphOf(context)
    if (subgraph === null) return ids.map((id) => ({ label: id }))
    const nodes = await services.resolveNodes(subgraph, ids)
    return ids.map((id) => {
      const node = nodes.get(id) ?? null
      return node === null
        ? { label: id, missing: true }
        : { label: node.label || node.nodeAggregateId }
    })
  }

  const assetLabel = async (
    id: string,
    shown: string,
  ): Promise<FormattedValue> => {
    const asset = await services.fetchAsset(id)
    return asset === null
      ? { label: shown, missing: true }
      : { label: asset.label || shown }
  }

  const text: ValueFormatter = (value) =>
    typeof value === 'string'
      ? labelOrNull(oneLine(value))
      : plainFormattedValue(value)

  const markup: ValueFormatter = (value) =>
    typeof value === 'string'
      ? labelOrNull(stripMarkup(value))
      : plainFormattedValue(value)

  const boolean: ValueFormatter = (value, { subject }) =>
    value === true ? { label: subject.label } : null

  const dateTime: ValueFormatter = (value, { options }) => {
    if (typeof value !== 'string' || value === '') return null
    const date = parseIso(value)
    if (date === null) return { label: value }
    const format =
      services.option(options, 'format') ??
      (typeof options.format === 'string' ? options.format : undefined) ??
      'd-m-Y'
    return { label: phpFormat(date, format) }
  }

  const range: ValueFormatter = (value, { options }) => {
    const number = typeof value === 'string' ? Number(value) : value
    if (typeof number !== 'number' || value === '' || Number.isNaN(number)) {
      return null
    }
    const unit = typeof options.unit === 'string' ? options.unit : ''
    return { label: `${number}${unit}` }
  }

  const select: ValueFormatter = (value, context) => {
    const keys = selectKeys(value)
    if (keys.length === 0) return null
    const { options } = context
    const identifier = services.option(options, 'dataSourceIdentifier')
    if (identifier === undefined) {
      if (options.dataSourceUri !== undefined) {
        return joined(keys.map((key) => ({ label: key })))
      }
      const values = objectOption(options, 'values') ?? {}
      return joined(
        keys.map((key) => {
          if (!(key in values)) return { label: key }
          const config = values[key] as { label?: unknown } | null
          return {
            label: services.humanizeLabel(
              typeof config?.label === 'string' ? config.label : null,
              key,
            ),
          }
        }),
      )
    }
    return services
      .fetchDataSource({
        identifier,
        node: context.nodeAddress,
        additionalData: objectOption(options, 'dataSourceAdditionalData'),
        disableCaching: options.dataSourceDisableCaching === true,
      })
      .then((data) => {
        const labels = dataSourceLabels(data)
        return joined(keys.map((key) => ({ label: labels.get(key) ?? key })))
      })
  }

  const link: ValueFormatter = async (value, context) => {
    if (typeof value !== 'string' || value === '') return null
    const document = parseDocumentUri(value)
    if (document !== null) {
      if (subgraphOf(context) === null) return { label: value }
      const [label] = await nodeLabels([document.aggregateId], context)
      if (label === undefined) return { label: value }
      if (label.missing) return { label: value, missing: true }
      return {
        label: document.anchor
          ? `${label.label} #${document.anchor}`
          : label.label,
      }
    }
    const asset = parseAssetUri(value)
    if (asset !== null) return assetLabel(asset, value)
    return { label: value }
  }

  const reference: ValueFormatter = async (value, context) => {
    const ids = referenceIds(value)
    if (ids.length === 0) return null
    return joined(await nodeLabels(ids, context))
  }

  const nodeType: ValueFormatter = async (value, context) => {
    if (typeof value !== 'string' || value === '') return null
    const subgraph = subgraphOf(context)
    const label =
      subgraph === null
        ? null
        : await services.nodeTypeLabel(subgraph.contentRepositoryId, value)
    return { label: label ?? value }
  }

  const asset: ValueFormatter = async (value) => {
    const ids = (Array.isArray(value) ? value : [value])
      .map(referenceIdentifier)
      .filter((id): id is string => id !== null)
    if (ids.length === 0) return null
    return joined(await Promise.all(ids.map((id) => assetLabel(id, id))))
  }

  return {
    text,
    markup,
    boolean,
    dateTime,
    range,
    select,
    link,
    reference,
    nodeType,
    asset,
  }
}
