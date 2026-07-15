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
