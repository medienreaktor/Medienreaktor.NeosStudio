import {
  keepPreviousData,
  skipToken,
  useInfiniteQuery,
  useQuery,
} from '@tanstack/react-query'
import { queryClient } from '@/app/queryClient'
import { ApiError, isConflict } from '../../http/errors'
import { api, apiUpload, unwrap } from '../client'
import { neosKeys } from '../keys'
import type {
  Asset,
  AssetCollection,
  AssetCollectionCreate,
  AssetCollectionUpdate,
  AssetTag,
  AssetTagCreate,
  AssetTagUpdate,
  AssetType,
  AssetUpdate,
  AssetVariantCreate,
  CropRectangle,
} from '../schema'

/**
 * The media (Neos.Api's Assets, AssetTags and AssetCollections tags): assets
 * across all asset sources, the local Neos one taking uploads and edits.
 */

/** The id of the local Neos asset source - the only one taking uploads. */
const LOCAL_ASSET_SOURCE = 'neos'

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

/** The listAssets query of a page of the filtered list. */
function assetListQuery(filter: AssetListFilter, offset: number) {
  const search = filter.search.trim()
  const field = filter.sortBy === 'name' ? 'name' : 'lastModified'
  const tags = tagFilterApplies(filter)
  return {
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
  }
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
    queryFn: enabled
      ? ({ pageParam, signal }) =>
          unwrap(
            api.GET('/assets/{assetSourceId}', {
              params: {
                path: { assetSourceId: filter.assetSource },
                query: assetListQuery(filter, pageParam),
              },
              signal,
            }),
          )
      : skipToken,
    initialPageParam: 0,
    getNextPageParam: (last, _pages, offset) => {
      const next = offset + last.data.length
      return last.data.length > 0 && next < last.meta.total ? next : undefined
    },
    // Keep the previous results on screen while a new search/filter loads, so
    // the grid updates in place instead of flickering through an empty state.
    placeholderData: keepPreviousData,
  })
}

const ASSET = '/assets/{assetSourceId}/{assetId}'

/** The path parameters of a local Neos asset. */
function localAsset(assetId: string) {
  return { assetSourceId: LOCAL_ASSET_SOURCE, assetId }
}

function fetchAsset(
  assetSourceId: string,
  assetId: string,
  signal?: AbortSignal,
): Promise<Asset> {
  return unwrap(
    api.GET(ASSET, { params: { path: { assetSourceId, assetId } }, signal }),
  )
}

export function useAsset(
  assetSourceId: string,
  assetId: string | null,
  enabled = true,
) {
  return useQuery({
    queryKey: neosKeys.assets.asset(assetSourceId, assetId ?? ''),
    queryFn:
      enabled && assetId !== null
        ? ({ signal }) => fetchAsset(assetSourceId, assetId, signal)
        : skipToken,
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
    queryFn:
      enabled && assetId !== null
        ? ({ signal }) =>
            unwrap(
              api.GET(`${ASSET}/usages`, {
                params: { path: { assetSourceId, assetId } },
                signal,
              }),
            )
        : skipToken,
  })
}

export function useAssetSources(enabled = true) {
  return useQuery({
    queryKey: neosKeys.assets.sources,
    queryFn: enabled
      ? async ({ signal }) =>
          (await unwrap(api.GET('/assets', { signal }))).data
      : skipToken,
  })
}

export function useAssetCollections(enabled = true) {
  return useQuery({
    queryKey: neosKeys.assets.collections,
    queryFn: enabled
      ? async ({ signal }) =>
          (await unwrap(api.GET('/assetcollections', { signal }))).data
      : skipToken,
  })
}

/** The tag tree (top-level tags with their children). */
export function useAssetTags(enabled = true) {
  return useQuery({
    queryKey: neosKeys.assets.tags,
    queryFn: enabled
      ? async ({ signal }) =>
          (await unwrap(api.GET('/assettags', { signal }))).data
      : skipToken,
  })
}

// --- Writes (await-then-invalidate; no optimistic updates) ---
//
// Each write puts the asset it answers with into its detail query and
// invalidates only the reads it can have changed: the asset lists (which
// list it, filtered and sorted by what it changed) together with the tag
// and collection counts, or - for a tag or collection renamed or deleted -
// the asset details too, whose references carry their labels.

/** The asset as a write answered with it, into its detail query. */
function cacheAsset(asset: Asset): void {
  queryClient.setQueryData(
    neosKeys.assets.asset(asset.assetSourceId, asset.id),
    asset,
  )
}

/**
 * Refetch the asset lists (every filter, every page) and the tag and
 * collection listings, whose asset counts follow them. What every write
 * adding, removing or changing an asset invalidates - and what a batch of
 * uploads with `invalidate: false` calls once, after the last one.
 */
export async function invalidateAssetLists(): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: neosKeys.assets.lists }),
    queryClient.invalidateQueries({ queryKey: neosKeys.assets.tags }),
    queryClient.invalidateQueries({ queryKey: neosKeys.assets.collections }),
  ])
}

/**
 * Refetch every asset read: the lists and counts, and all asset details -
 * after a tag or collection was renamed or deleted, which the assets'
 * references show.
 */
function invalidateAllAssetReads(): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: neosKeys.assets.all })
}

/** Whether a failed delete was refused because the asset is in use. */
export const isAssetInUse = isConflict

export interface UploadOptions {
  collection?: string | null
  tags?: string[]
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
  /**
   * Invalidate the asset lists when done (true by default). A batch of
   * uploads passes false and calls invalidateAssetLists() once after the
   * last one, instead of refetching every list per file.
   */
  invalidate?: boolean
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

  let asset = await apiUpload(
    'post',
    '/assets/{assetSourceId}',
    { assetSourceId: LOCAL_ASSET_SOURCE },
    form,
    { onProgress: options.onProgress, signal: options.signal },
  )
  // A duplicate: apply the memberships the upload asked for (PUT is
  // idempotent, so already-present ones are no-ops).
  const collection = options.collection
  if (
    collection &&
    !(asset.collections ?? []).some((candidate) => candidate.id === collection)
  ) {
    asset = await unwrap(
      api.PUT(`${ASSET}/collections/{assetCollectionId}`, {
        params: {
          path: { ...localAsset(asset.id), assetCollectionId: collection },
        },
      }),
    )
  }
  for (const tag of options.tags ?? []) {
    if ((asset.tags ?? []).some((candidate) => candidate.id === tag)) continue
    asset = await unwrap(
      api.PUT(`${ASSET}/tags/{assetTagId}`, {
        params: { path: { ...localAsset(asset.id), assetTagId: tag } },
      }),
    )
  }
  cacheAsset(asset)
  if (options.invalidate !== false) await invalidateAssetLists()
  return asset
}

export async function updateAsset(
  assetId: string,
  update: AssetUpdate,
): Promise<Asset> {
  const asset = await unwrap(
    api.PATCH(ASSET, { params: { path: localAsset(assetId) }, body: update }),
  )
  cacheAsset(asset)
  await invalidateAssetLists()
  return asset
}

/** Deletes a local asset; an asset in use is refused (409, see isAssetInUse). */
export async function deleteAsset(assetId: string): Promise<void> {
  await unwrap(api.DELETE(ASSET, { params: { path: localAsset(assetId) } }))
  // The detail and its usages are gone with it.
  queryClient.removeQueries({
    queryKey: neosKeys.assets.asset(LOCAL_ASSET_SOURCE, assetId),
  })
  await invalidateAssetLists()
}

export interface ReplaceResourceOptions {
  /**
   * Keep the asset's current filename instead of taking the new file's, with
   * only the extension adjusted when the media type differs.
   */
  keepOriginalFilename?: boolean
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
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
  const asset = await apiUpload(
    'put',
    '/assets/{assetSourceId}/{assetId}/file',
    localAsset(assetId),
    form,
    { onProgress: options.onProgress, signal: options.signal },
  )
  cacheAsset(asset)
  // The lists show its thumbnail, filename and size.
  await invalidateAssetLists()
  return asset
}

/**
 * Create a cropped variant of a local image. Pass the *original* image's id
 * (not a variant's) and the crop in the original's pixel coordinates; the
 * server persists a new ImageVariant (or returns an equal one it has already).
 * The caller stores the variant's id as the image property value. Variants
 * are not listed, so no list changes.
 */
export async function createImageVariant(
  originalId: string,
  crop: CropRectangle,
): Promise<Asset> {
  const asset = await unwrap(
    api.POST(`${ASSET}/variants`, {
      params: { path: localAsset(originalId) },
      body: { crop } satisfies AssetVariantCreate,
    }),
  )
  cacheAsset(asset)
  return asset
}

/** Import a remote asset into Neos; resolves with the asset in Neos. */
export async function importAsset(
  assetSourceId: string,
  assetId: string,
): Promise<Asset> {
  const asset = await unwrap(
    api.POST(`${ASSET}/import`, {
      params: { path: { assetSourceId, assetId } },
    }),
  )
  cacheAsset(asset)
  // The remote asset now has a local one (its localAssetId), and the local
  // lists have a new asset.
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: neosKeys.assets.asset(assetSourceId, assetId),
    }),
    invalidateAssetLists(),
  ])
  return asset
}

/**
 * Add (PUT, idempotent) or remove (DELETE) a membership. Removing one the
 * asset does not have is a 404 - already the wanted state, so it resolves
 * with the asset as it is.
 */
async function setMembership(
  write: (method: 'PUT' | 'DELETE') => Promise<Asset>,
  assetId: string,
  assigned: boolean,
): Promise<Asset> {
  let asset: Asset
  try {
    asset = await write(assigned ? 'PUT' : 'DELETE')
  } catch (error) {
    if (assigned || !(error instanceof ApiError) || error.status !== 404)
      throw error
    asset = await fetchAsset(LOCAL_ASSET_SOURCE, assetId)
  }
  cacheAsset(asset)
  await invalidateAssetLists()
  return asset
}

export function setAssetTag(
  assetId: string,
  tagId: string,
  assigned: boolean,
): Promise<Asset> {
  const params = {
    path: { ...localAsset(assetId), assetTagId: tagId },
  }
  return setMembership(
    (method) =>
      unwrap(
        method === 'PUT'
          ? api.PUT(`${ASSET}/tags/{assetTagId}`, { params })
          : api.DELETE(`${ASSET}/tags/{assetTagId}`, { params }),
      ),
    assetId,
    assigned,
  )
}

export function setAssetCollection(
  assetId: string,
  collectionId: string,
  assigned: boolean,
): Promise<Asset> {
  const params = {
    path: { ...localAsset(assetId), assetCollectionId: collectionId },
  }
  return setMembership(
    (method) =>
      unwrap(
        method === 'PUT'
          ? api.PUT(`${ASSET}/collections/{assetCollectionId}`, { params })
          : api.DELETE(`${ASSET}/collections/{assetCollectionId}`, {
              params,
            }),
      ),
    assetId,
    assigned,
  )
}

/** A new collection: only the collection listing changes. */
export async function createAssetCollection(
  title: string,
): Promise<AssetCollection> {
  const collection = await unwrap(
    api.POST('/assetcollections', {
      body: { title } satisfies AssetCollectionCreate,
    }),
  )
  await queryClient.invalidateQueries({
    queryKey: neosKeys.assets.collections,
  })
  return collection
}

/** Renames a collection - which the assets' references show as well. */
export async function updateAssetCollection(
  collectionId: string,
  title: string,
): Promise<AssetCollection> {
  const collection = await unwrap(
    api.PATCH('/assetcollections/{assetCollectionId}', {
      params: { path: { assetCollectionId: collectionId } },
      body: { title } satisfies AssetCollectionUpdate,
    }),
  )
  await invalidateAllAssetReads()
  return collection
}

export async function deleteAssetCollection(
  collectionId: string,
): Promise<void> {
  await unwrap(
    api.DELETE('/assetcollections/{assetCollectionId}', {
      params: { path: { assetCollectionId: collectionId } },
    }),
  )
  await invalidateAllAssetReads()
}

/** A new tag: only the tag tree changes. */
export async function createAssetTag(
  label: string,
  parentId?: string | null,
): Promise<AssetTag> {
  const tag = await unwrap(
    api.POST('/assettags', {
      body: { label, parentId: parentId ?? null } satisfies AssetTagCreate,
    }),
  )
  await queryClient.invalidateQueries({ queryKey: neosKeys.assets.tags })
  return tag
}

/**
 * Rename and/or move a tag. parentId null moves it to the root. A rename
 * shows in the assets' references as well.
 */
export async function updateAssetTag(
  tagId: string,
  update: AssetTagUpdate,
): Promise<AssetTag> {
  const tag = await unwrap(
    api.PATCH('/assettags/{assetTagId}', {
      params: { path: { assetTagId: tagId } },
      body: update,
    }),
  )
  if (update.label !== undefined) await invalidateAllAssetReads()
  else await queryClient.invalidateQueries({ queryKey: neosKeys.assets.tags })
  return tag
}

export async function deleteAssetTag(tagId: string): Promise<void> {
  await unwrap(
    api.DELETE('/assettags/{assetTagId}', {
      params: { path: { assetTagId: tagId } },
    }),
  )
  await invalidateAllAssetReads()
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
 * a bare id and the content repository's serialized object reference
 * (`{__flow_object_type, __identifier}`) - which Neos.Api passes through
 * as stored when it cannot resolve a value to assets, e.g. a list one of
 * whose assets is gone.
 */
export function referenceIdentifier(value: unknown): string | null {
  if (typeof value === 'string') return value === '' ? null : value
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const id = record.id ?? record.__identifier
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
