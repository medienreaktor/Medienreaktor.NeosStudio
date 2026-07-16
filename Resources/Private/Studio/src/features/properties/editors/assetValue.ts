import { importProxyAsset, type AssetType, type MediaAsset } from '@/api/media'

/**
 * The value an asset- or image-typed node property stores. It is the Content
 * Repository's own serialized object reference and round-trips verbatim through
 * the read and commands APIs (which do no per-type conversion): the API hands
 * back exactly this shape, and the SetNodeProperties command takes it back
 * unchanged. `__flow_object_type` must be a concrete, instantiable Media entity
 * class (the projection reloads the object by that exact class), and
 * `__identifier` the local Neos asset UUID. `null` unsets the property.
 *
 * Note the double underscores and the `__identifier` spelling (not
 * `__identity`) - the CR's DoctrinePersistentObjectNormalizer reads these two
 * keys and nothing else.
 */
export interface AssetReference {
  __flow_object_type: string
  __identifier: string
}

const MEDIA_MODEL_NAMESPACE = 'Neos\\Media\\Domain\\Model\\'

/** The concrete Media entity class an image property stores. */
export const IMAGE_CLASS = `${MEDIA_MODEL_NAMESPACE}Image`

/** The base Media entity class - the fallback when a stored item omits its concrete type. */
export const ASSET_CLASS = `${MEDIA_MODEL_NAMESPACE}Asset`

/**
 * Whether a node property type is a collection (`array<...>`), as multi-asset
 * properties are declared - e.g. `array<Neos\Media\Domain\Model\Asset>`. Such a
 * property stores a list of references and edits with the multiple-asset UI.
 */
export function isCollectionType(type: string): boolean {
  return /^array<.+>$/.test(type)
}

/** The concrete Media entity class for an asset of the given type. */
export function assetClassFor(assetType: AssetType): string {
  return `${MEDIA_MODEL_NAMESPACE}${assetType}`
}

/** The stored asset identifier read off a property value, across the shapes it may take. */
export function referenceIdentifier(value: unknown): string | null {
  if (typeof value === 'string') return value === '' ? null : value
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const id = record.__identifier ?? record.__identity
    if (typeof id === 'string' && id !== '') return id
  }
  return null
}

/**
 * One stored item to a full reference, or null if it carries no identifier.
 * Keeps the item's concrete `__flow_object_type` when present (round-tripped
 * data always has it), falling back to the base Asset class otherwise.
 */
function toReference(value: unknown): AssetReference | null {
  const id = referenceIdentifier(value)
  if (!id) return null
  const type =
    value && typeof value === 'object'
      ? (value as Record<string, unknown>).__flow_object_type
      : undefined
  return {
    __flow_object_type: typeof type === 'string' && type ? type : ASSET_CLASS,
    __identifier: id,
  }
}

/**
 * A stored multi-asset value as a list of references, tolerant of the shapes
 * the API may hand back. A non-array value (unset, or a single reference) reads
 * as empty - a collection property is only ever seeded from a list.
 */
export function referenceList(value: unknown): AssetReference[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const ref = toReference(item)
    return ref ? [ref] : []
  })
}

export function imageReference(identifier: string): AssetReference {
  return { __flow_object_type: IMAGE_CLASS, __identifier: identifier }
}

export function assetReference(
  asset: MediaAsset,
  identifier: string,
): AssetReference {
  return {
    __flow_object_type: assetClassFor(asset.assetType),
    __identifier: identifier,
  }
}

/**
 * The local Neos asset UUID to store for a picked asset. Local assets carry it
 * directly; an asset from a remote source (a DAM) must be imported into Neos
 * first, which returns the now-local asset. The stored identifier is always a
 * local one, so the property resolves against the 'neos' source.
 */
export async function localIdentifierFor(asset: MediaAsset): Promise<string> {
  if (asset.localAssetIdentifier) return asset.localAssetIdentifier
  if (!asset.isRemote) return asset.identifier
  const imported = await importProxyAsset(asset.assetSource, asset.identifier)
  return imported.localAssetIdentifier ?? imported.identifier
}
