import { importProxyAsset, type MediaAsset } from './media'

/**
 * The value an asset- or image-typed node property is written with: Neos.Api
 * takes an asset by its (local Neos) id, `{id}`, and reads it back as
 * `{id, url}`; a list property takes and yields a list of them. `null` unsets
 * the property. A cropped image is just another asset id - the image
 * variant's.
 */
export interface AssetReference {
  id: string
}

/**
 * Whether a node property type is a collection (`array<...>`), as multi-asset
 * properties are declared - e.g. `array<Neos\Media\Domain\Model\Asset>`. Such a
 * property stores a list of references and edits with the multiple-asset UI.
 */
export function isCollectionType(type: string): boolean {
  return /^array<.+>$/.test(type)
}

/**
 * The asset id read off a property value: Neos.Api's `{id, url}`, tolerating
 * a bare id and the legacy serialized object reference (`__identifier`).
 */
export function referenceIdentifier(value: unknown): string | null {
  if (typeof value === 'string') return value === '' ? null : value
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const id = record.id ?? record.__identifier ?? record.__identity
    if (typeof id === 'string' && id !== '') return id
  }
  return null
}

/**
 * A stored multi-asset value as a list of references. A non-array value
 * (unset, or a single reference) reads as empty - a collection property is
 * only ever seeded from a list.
 */
export function referenceList(value: unknown): AssetReference[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const id = referenceIdentifier(item)
    return id ? [{ id }] : []
  })
}

/** The value to write for an asset (or image, or image variant) id. */
export function assetReference(id: string): AssetReference {
  return { id }
}

/**
 * The local Neos asset id to store for a picked asset. Local assets carry it
 * directly; an asset from a remote source (a DAM) must be imported into Neos
 * first, which returns the now-local asset. The stored id is always a local
 * one, so the property resolves against the 'neos' source.
 */
export async function localAssetIdFor(asset: MediaAsset): Promise<string> {
  if (asset.localAssetId) return asset.localAssetId
  if (!asset.isRemote) return asset.id
  const imported = await importProxyAsset(asset.assetSourceId, asset.id)
  return imported.localAssetId ?? imported.id
}
