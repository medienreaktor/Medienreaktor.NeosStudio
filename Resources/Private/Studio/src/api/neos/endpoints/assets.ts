import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
} from '@tanstack/react-query'
import { queryClient } from '@/app/queryClient'
import { ApiError, isConflict } from '../../http/errors'
import { queryString } from '../../http/request'
import { apiFetch, apiUpload, type Listing } from '../client'
import { neosKeys } from '../keys'
import type {
  Asset,
  AssetCollection,
  AssetSource,
  AssetTag,
  AssetTagUpdate,
  AssetType,
  AssetUpdate,
  AssetUsageListing,
  CropRectangle,
  PaginatedAssetListing,
} from '../schema'

/**
 * The media (Neos.Api's Assets, AssetTags and AssetCollections tags): assets
 * across all asset sources, the local Neos one taking uploads and edits.
 */

/** The id of the local Neos asset source - the only one taking uploads. */
export const LOCAL_ASSET_SOURCE = 'neos'

/** From another asset source than the local Neos one (a DAM). */
export function isRemoteAsset(asset: Asset): boolean {
  return asset.assetSourceId !== LOCAL_ASSET_SOURCE
}

/** A remote asset that has been imported into Neos already. */
export function isImportedAsset(asset: Asset): boolean {
  return isRemoteAsset(asset) && asset.localAssetId !== null
}

/** The controls the browser toolbar/sidebar drive the list with. */
export interface AssetListFilter {
  assetSource: string
  type: AssetType | 'all'
  search: string
  collection: string | null
  tag: string | null
  /** 'given' honours `tag`; 'none' lists untagged assets. */
  tagMode: 'given' | 'none'
  sortBy: 'modified' | 'name'
  sortDirection: 'asc' | 'desc'
}

export const DEFAULT_ASSET_FILTER: AssetListFilter = {
  assetSource: LOCAL_ASSET_SOURCE,
  type: 'all',
  search: '',
  collection: null,
  tag: null,
  tagMode: 'given',
  sortBy: 'modified',
  sortDirection: 'desc',
}

/**
 * Whether the tag filter applies to the list. Neos.Api cannot combine a
 * search with a tag filter (or the untagged one), so a search lists across
 * all tags - the browser shows the tag filter as suspended meanwhile.
 */
export function tagFilterApplies(filter: AssetListFilter): boolean {
  return filter.search.trim() === ''
}

const PAGE_SIZE = 40

function assetListPath(filter: AssetListFilter, offset: number): string {
  const search = filter.search.trim()
  const field = filter.sortBy === 'name' ? 'name' : 'lastModified'
  const tags = tagFilterApplies(filter)
  return `/assets/${encodeURIComponent(filter.assetSource)}${queryString({
    filterByAssetType: filter.type !== 'all' ? filter.type : undefined,
    filterByCollection: filter.collection ?? undefined,
    filterByTag:
      tags && filter.tagMode === 'given'
        ? (filter.tag ?? undefined)
        : undefined,
    filterByUntagged: tags && filter.tagMode === 'none' ? true : undefined,
    search: search !== '' ? search : undefined,
    sort: filter.sortDirection === 'desc' ? `-${field}` : field,
    offset,
    limit: PAGE_SIZE,
  })}`
}

/**
 * The paginated asset list as an infinite query: one Neos.Api listing per
 * page, the grid appends pages as the user scrolls (the page param is the
 * offset). The whole filter object is the query key, so changing any control
 * starts a fresh list.
 */
export function useAssets(filter: AssetListFilter, enabled = true) {
  return useInfiniteQuery({
    queryKey: neosKeys.assets.list(
      filter as unknown as Record<string, unknown>,
    ),
    queryFn: ({ pageParam }) =>
      apiFetch<PaginatedAssetListing>(assetListPath(filter, pageParam)),
    initialPageParam: 0,
    getNextPageParam: (last, _pages, offset) => {
      const next = offset + last.data.length
      return last.data.length > 0 && next < last.meta.total ? next : undefined
    },
    // Keep the previous results on screen while a new search/filter loads, so
    // the grid updates in place instead of flickering through an empty state.
    placeholderData: keepPreviousData,
    enabled,
  })
}

function assetPath(assetSourceId: string, assetId: string): string {
  return `/assets/${encodeURIComponent(assetSourceId)}/${encodeURIComponent(assetId)}`
}

/** A local Neos asset's path. */
function localAssetPath(assetId: string): string {
  return assetPath(LOCAL_ASSET_SOURCE, assetId)
}

export function fetchAsset(
  assetSourceId: string,
  assetId: string,
): Promise<Asset> {
  return apiFetch<Asset>(assetPath(assetSourceId, assetId))
}

export function useAsset(
  assetSourceId: string,
  assetId: string | null,
  enabled = true,
) {
  return useQuery({
    queryKey: neosKeys.assets.asset(assetSourceId, assetId ?? ''),
    queryFn: () => fetchAsset(assetSourceId, assetId!),
    enabled: enabled && assetId !== null,
  })
}

/** The nodes using the asset (and how many more the account may not read). */
export function useAssetUsages(
  assetSourceId: string,
  assetId: string | null,
  enabled = true,
) {
  return useQuery({
    queryKey: neosKeys.assets.usages(assetSourceId, assetId ?? ''),
    queryFn: () =>
      apiFetch<AssetUsageListing>(
        `${assetPath(assetSourceId, assetId!)}/usages`,
      ),
    enabled: enabled && assetId !== null,
  })
}

export function useAssetSources(enabled = true) {
  return useQuery({
    queryKey: neosKeys.assets.sources,
    queryFn: async () => (await apiFetch<Listing<AssetSource>>('/assets')).data,
    enabled,
  })
}

export function useAssetCollections(enabled = true) {
  return useQuery({
    queryKey: neosKeys.assets.collections,
    queryFn: async () =>
      (await apiFetch<Listing<AssetCollection>>('/assetcollections')).data,
    enabled,
  })
}

/** The tag tree (top-level tags with their children). */
export function useAssetTags(enabled = true) {
  return useQuery({
    queryKey: neosKeys.assets.tags,
    queryFn: async () => (await apiFetch<Listing<AssetTag>>('/assettags')).data,
    enabled,
  })
}

// --- Writes (await-then-invalidate; no optimistic updates) ---

/** Drop every cached media read. Called after any write. */
function invalidateAssets(): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: neosKeys.assets.all })
}

/** Whether a failed delete was refused because the asset is in use. */
export const isAssetInUse = isConflict

export interface UploadOptions {
  collection?: string | null
  tags?: string[]
  onProgress?: (fraction: number) => void
}

/**
 * Upload a file into the local Neos source. A file Neos has already (same
 * content) is not added again - Neos.Api answers with the existing asset and
 * ignores the fields, so the requested collection and tags are added to it
 * explicitly.
 */
export async function uploadAsset(
  file: File,
  options: UploadOptions = {},
): Promise<Asset> {
  const form = new FormData()
  form.append('file', file)
  if (options.collection) form.append('collectionIds[]', options.collection)
  for (const tag of options.tags ?? []) form.append('tagIds[]', tag)

  let asset = await apiUpload<Asset>(`/assets/${LOCAL_ASSET_SOURCE}`, form, {
    onProgress: options.onProgress,
  })
  // A duplicate: apply the memberships the upload asked for (PUT is
  // idempotent, so already-present ones are no-ops).
  const collection = options.collection
  if (
    collection &&
    !(asset.collections ?? []).some((candidate) => candidate.id === collection)
  ) {
    asset = await apiFetch<Asset>(
      `${localAssetPath(asset.id)}/collections/${encodeURIComponent(collection)}`,
      { method: 'PUT' },
    )
  }
  for (const tag of options.tags ?? []) {
    if ((asset.tags ?? []).some((candidate) => candidate.id === tag)) continue
    asset = await apiFetch<Asset>(
      `${localAssetPath(asset.id)}/tags/${encodeURIComponent(tag)}`,
      { method: 'PUT' },
    )
  }
  await invalidateAssets()
  return asset
}

export async function updateAsset(
  assetId: string,
  update: AssetUpdate,
): Promise<Asset> {
  const asset = await apiFetch<Asset>(localAssetPath(assetId), {
    method: 'PATCH',
    body: update,
  })
  await invalidateAssets()
  return asset
}

/** Deletes a local asset; an asset in use is refused (409, see isAssetInUse). */
export async function deleteAsset(assetId: string): Promise<void> {
  await apiFetch(localAssetPath(assetId), { method: 'DELETE' })
  await invalidateAssets()
}

export interface ReplaceResourceOptions {
  /**
   * Keep the asset's current filename instead of taking the new file's, with
   * only the extension adjusted when the media type differs.
   */
  keepOriginalFilename?: boolean
  onProgress?: (fraction: number) => void
}

/**
 * Swap the file behind a local asset, keeping its identity, metadata, tags and
 * usages - every node referencing it renders the new file. The server refuses a
 * different media type family (image -> pdf) and cropped image variants.
 */
export async function replaceAssetResource(
  assetId: string,
  file: File,
  options: ReplaceResourceOptions = {},
): Promise<Asset> {
  const form = new FormData()
  form.append('file', file)
  form.append(
    'keepOriginalFilename',
    options.keepOriginalFilename ? 'true' : 'false',
  )
  const asset = await apiUpload<Asset>(
    `${localAssetPath(assetId)}/file`,
    form,
    {
      method: 'PUT',
      onProgress: options.onProgress,
    },
  )
  await invalidateAssets()
  return asset
}

/**
 * Create a cropped variant of a local image. Pass the *original* image's id
 * (not a variant's) and the crop in the original's pixel coordinates; the
 * server persists a new ImageVariant (or returns an equal one it has already).
 * The caller stores the variant's id as the image property value.
 */
export async function createImageVariant(
  originalId: string,
  crop: CropRectangle,
): Promise<Asset> {
  const asset = await apiFetch<Asset>(
    `${localAssetPath(originalId)}/variants`,
    {
      method: 'POST',
      body: { crop },
    },
  )
  await invalidateAssets()
  return asset
}

/** Import a remote asset into Neos; resolves with the asset in Neos. */
export async function importAsset(
  assetSourceId: string,
  assetId: string,
): Promise<Asset> {
  const asset = await apiFetch<Asset>(
    `${assetPath(assetSourceId, assetId)}/import`,
    { method: 'POST' },
  )
  await invalidateAssets()
  return asset
}

/**
 * Add (PUT, idempotent) or remove (DELETE) a membership sub-resource. Removing
 * one the asset does not have is a 404 - already the wanted state, so it
 * resolves with the asset as it is.
 */
async function setMembership(
  path: string,
  assetId: string,
  assigned: boolean,
): Promise<Asset> {
  let asset: Asset
  try {
    asset = await apiFetch<Asset>(path, {
      method: assigned ? 'PUT' : 'DELETE',
    })
  } catch (error) {
    if (assigned || !(error instanceof ApiError) || error.status !== 404)
      throw error
    asset = await apiFetch<Asset>(localAssetPath(assetId))
  }
  await invalidateAssets()
  return asset
}

export function setAssetTag(
  assetId: string,
  tagId: string,
  assigned: boolean,
): Promise<Asset> {
  return setMembership(
    `${localAssetPath(assetId)}/tags/${encodeURIComponent(tagId)}`,
    assetId,
    assigned,
  )
}

export function setAssetCollection(
  assetId: string,
  collectionId: string,
  assigned: boolean,
): Promise<Asset> {
  return setMembership(
    `${localAssetPath(assetId)}/collections/${encodeURIComponent(collectionId)}`,
    assetId,
    assigned,
  )
}

export async function createAssetCollection(
  title: string,
): Promise<AssetCollection> {
  const collection = await apiFetch<AssetCollection>('/assetcollections', {
    method: 'POST',
    body: { title },
  })
  await invalidateAssets()
  return collection
}

export async function updateAssetCollection(
  collectionId: string,
  title: string,
): Promise<AssetCollection> {
  const collection = await apiFetch<AssetCollection>(
    `/assetcollections/${encodeURIComponent(collectionId)}`,
    { method: 'PATCH', body: { title } },
  )
  await invalidateAssets()
  return collection
}

export async function deleteAssetCollection(
  collectionId: string,
): Promise<void> {
  await apiFetch(`/assetcollections/${encodeURIComponent(collectionId)}`, {
    method: 'DELETE',
  })
  await invalidateAssets()
}

export async function createAssetTag(
  label: string,
  parentId?: string | null,
): Promise<AssetTag> {
  const tag = await apiFetch<AssetTag>('/assettags', {
    method: 'POST',
    body: { label, parentId: parentId ?? null },
  })
  await invalidateAssets()
  return tag
}

/** Rename and/or move a tag. parentId null moves it to the root. */
export async function updateAssetTag(
  tagId: string,
  update: AssetTagUpdate,
): Promise<AssetTag> {
  const tag = await apiFetch<AssetTag>(
    `/assettags/${encodeURIComponent(tagId)}`,
    { method: 'PATCH', body: update },
  )
  await invalidateAssets()
  return tag
}

export async function deleteAssetTag(tagId: string): Promise<void> {
  await apiFetch(`/assettags/${encodeURIComponent(tagId)}`, {
    method: 'DELETE',
  })
  await invalidateAssets()
}

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
 * properties are declared - e.g. `array<Neos\Media\Domain\Model\Asset>`.
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
 * (unset, or a single reference) reads as empty.
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
 * directly; an asset from a remote source (a DAM) is imported into Neos
 * first. The stored id is always a local one.
 */
export async function localAssetIdFor(asset: Asset): Promise<string> {
  if (asset.localAssetId) return asset.localAssetId
  if (!isRemoteAsset(asset)) return asset.id
  const imported = await importAsset(asset.assetSourceId, asset.id)
  return imported.localAssetId ?? imported.id
}
