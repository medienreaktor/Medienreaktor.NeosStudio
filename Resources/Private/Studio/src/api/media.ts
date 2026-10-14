import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
} from '@tanstack/react-query'

import { queryClient } from '@/app/queryClient'
import {
  ApiError,
  apiFetch,
  apiUpload,
  queryString,
  type Listing,
} from './client'
import { queryKeys } from './keys'

/** The asset types of Neos.Api (lowercase). */
export type AssetType = 'image' | 'document' | 'video' | 'audio'

export interface AssetTagRef {
  id: string
  label: string
}

export interface AssetCollectionRef {
  id: string
  title: string
}

/** A crop rectangle in the original image's pixel coordinates. */
export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

/** Neos.Api's Asset. */
interface ApiAsset {
  assetSourceId: string
  id: string
  localAssetId: string | null
  label: string
  filename: string
  mediaType: string
  assetType: AssetType
  fileSize: number
  lastModified: string
  width: number | null
  height: number | null
  thumbnailUri: string | null
  previewUri: string | null
  isReadOnly: boolean
  title: string | null
  caption: string | null
  copyrightNotice: string | null
  tags: AssetTagRef[] | null
  collections: AssetCollectionRef[] | null
  originalAssetId: string | null
  crop: CropRect | null
  iptc: {
    title: string | null
    caption: string | null
    copyrightNotice: string | null
  } | null
}

/**
 * An asset across all asset sources (Neos.Api's Asset plus two derived
 * flags). The editable metadata (title/caption/copyrightNotice, tags,
 * collections) is only set for local Neos assets; remote proxies carry
 * `iptc` instead.
 */
export interface MediaAsset extends ApiAsset {
  /** From another asset source than the local Neos one (a DAM). */
  isRemote: boolean
  /** A remote asset that has been imported into Neos already. */
  isImported: boolean
}

/** The id of the local Neos asset source - the only one taking uploads. */
export const LOCAL_ASSET_SOURCE = 'neos'

function toMediaAsset(asset: ApiAsset): MediaAsset {
  const isRemote = asset.assetSourceId !== LOCAL_ASSET_SOURCE
  return {
    ...asset,
    isRemote,
    isImported: isRemote && asset.localAssetId !== null,
  }
}

export interface AssetSource {
  id: string
  label: string
  description: string
  iconUri: string
  isReadOnly: boolean
  supportsTagging: boolean
  supportsCollections: boolean
  supportsSorting: boolean
}

export interface MediaCollection {
  id: string
  title: string
  assetCount: number
  tags: AssetTagRef[]
}

export interface MediaTag {
  id: string
  label: string
  parentId: string | null
  assetCount: number
  children: MediaTag[]
}

/** A node Neos.Api lists as a usage (the fields the Studio shows). */
export interface AssetUsageNode {
  contentRepositoryId: string
  workspaceName: string
  /** JSON, e.g. {"language":"en"} */
  dimensionSpacePoint: string
  nodeAggregateId: string
  label: string
}

export interface AssetUsage {
  node: AssetUsageNode
  documentNode: AssetUsageNode | null
}

export interface AssetUsageResponse {
  data: AssetUsage[]
  meta: {
    /** How many usages are listed. */
    total: number
    /** Usages besides, in nodes or workspaces the account may not read. */
    inaccessible: number
  }
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

export interface AssetPage {
  assets: MediaAsset[]
  total: number
  offset: number
}

/**
 * The paginated asset list as an infinite query - the grid/list appends pages
 * as the user scrolls. The whole filter object is the query key, so changing
 * any control starts a fresh list.
 */
export function useAssets(filter: AssetListFilter, enabled = true) {
  return useInfiniteQuery({
    queryKey: queryKeys.media.assets(
      filter as unknown as Record<string, unknown>,
    ),
    queryFn: async ({ pageParam }): Promise<AssetPage> => {
      const listing = await apiFetch<Listing<ApiAsset>>(
        assetListPath(filter, pageParam),
      )
      return {
        assets: listing.data.map(toMediaAsset),
        total: listing.meta.total,
        offset: pageParam,
      }
    },
    initialPageParam: 0,
    getNextPageParam: (last) => {
      const next = last.offset + last.assets.length
      return last.assets.length > 0 && next < last.total ? next : undefined
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
): Promise<MediaAsset> {
  return apiFetch<ApiAsset>(assetPath(assetSourceId, assetId)).then(
    toMediaAsset,
  )
}

export function useAsset(
  assetSourceId: string,
  assetId: string | null,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.media.asset(assetSourceId, assetId ?? ''),
    queryFn: () => fetchAsset(assetSourceId, assetId!),
    enabled: enabled && assetId !== null,
  })
}

export function useAssetUsage(
  assetSourceId: string,
  assetId: string | null,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.media.assetUsage(assetSourceId, assetId ?? ''),
    queryFn: () =>
      apiFetch<AssetUsageResponse>(
        `${assetPath(assetSourceId, assetId!)}/usages`,
      ),
    enabled: enabled && assetId !== null,
  })
}

export function useAssetSources(enabled = true) {
  return useQuery({
    queryKey: queryKeys.media.sources,
    queryFn: () =>
      apiFetch<Listing<AssetSource>>('/assets').then((r) => r.data),
    enabled,
  })
}

export function useAssetCollections(enabled = true) {
  return useQuery({
    queryKey: queryKeys.media.collections,
    queryFn: () =>
      apiFetch<Listing<MediaCollection>>('/assetcollections').then(
        (r) => r.data,
      ),
    enabled,
  })
}

/** The tag tree (top-level tags with their children). */
export function useTags(enabled = true) {
  return useQuery({
    queryKey: queryKeys.media.tags,
    queryFn: () =>
      apiFetch<Listing<MediaTag>>('/assettags').then((r) => r.data),
    enabled,
  })
}

// --- Writes (await-then-invalidate; no optimistic updates, matching the codebase) ---

/** Drop every cached media read. Called after any write. */
function invalidateMedia(): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: queryKeys.media.all })
}

/** Whether a failed delete was refused because the asset is in use. */
export function isAssetInUse(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409
}

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
): Promise<MediaAsset> {
  const form = new FormData()
  form.append('file', file)
  if (options.collection) form.append('collectionIds[]', options.collection)
  for (const tag of options.tags ?? []) form.append('tagIds[]', tag)

  let asset = await apiUpload<ApiAsset>(`/assets/${LOCAL_ASSET_SOURCE}`, form, {
    onProgress: options.onProgress,
  })
  // A duplicate: apply the memberships the upload asked for (PUT is
  // idempotent, so already-present ones are no-ops).
  const missingCollection =
    options.collection &&
    !(asset.collections ?? []).some((c) => c.id === options.collection)
  if (missingCollection) {
    asset = await apiFetch<ApiAsset>(
      `${localAssetPath(asset.id)}/collections/${encodeURIComponent(options.collection!)}`,
      { method: 'PUT' },
    )
  }
  for (const tag of options.tags ?? []) {
    if ((asset.tags ?? []).some((t) => t.id === tag)) continue
    asset = await apiFetch<ApiAsset>(
      `${localAssetPath(asset.id)}/tags/${encodeURIComponent(tag)}`,
      { method: 'PUT' },
    )
  }
  await invalidateMedia()
  return toMediaAsset(asset)
}

export interface AssetMetadataPatch {
  title?: string
  caption?: string
  copyrightNotice?: string
  /** Replaces the tags. */
  tagIds?: string[]
  /** Replaces the collections. */
  collectionIds?: string[]
}

export async function updateAsset(
  assetId: string,
  patch: AssetMetadataPatch,
): Promise<MediaAsset> {
  const asset = await apiFetch<ApiAsset>(localAssetPath(assetId), {
    method: 'PATCH',
    body: patch,
  })
  await invalidateMedia()
  return toMediaAsset(asset)
}

/** Deletes a local asset; an asset in use is refused (409, see isAssetInUse). */
export async function deleteAsset(assetId: string): Promise<void> {
  await apiFetch<null>(localAssetPath(assetId), { method: 'DELETE' })
  await invalidateMedia()
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
): Promise<MediaAsset> {
  const form = new FormData()
  form.append('file', file)
  form.append(
    'keepOriginalFilename',
    options.keepOriginalFilename ? 'true' : 'false',
  )
  const asset = await apiUpload<ApiAsset>(
    `${localAssetPath(assetId)}/file`,
    form,
    {
      method: 'PUT',
      onProgress: options.onProgress,
    },
  )
  await invalidateMedia()
  return toMediaAsset(asset)
}

/**
 * Create a cropped variant of a local image and return it as an asset. Pass the
 * *original* image's id (not a variant's) and the crop in the original's pixel
 * coordinates; the server persists a new ImageVariant (or returns an equal one
 * it has already) and returns it. The caller stores the returned variant's id
 * as the image property value.
 */
export async function createImageVariant(
  originalId: string,
  crop: CropRect,
): Promise<MediaAsset> {
  const asset = await apiFetch<ApiAsset>(
    `${localAssetPath(originalId)}/variants`,
    { method: 'POST', body: { crop } },
  )
  await invalidateMedia()
  return toMediaAsset(asset)
}

/** Import a remote asset into Neos; resolves with the asset in Neos. */
export async function importProxyAsset(
  assetSourceId: string,
  assetId: string,
): Promise<MediaAsset> {
  const asset = await apiFetch<ApiAsset>(
    `${assetPath(assetSourceId, assetId)}/import`,
    { method: 'POST' },
  )
  await invalidateMedia()
  return toMediaAsset(asset)
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
): Promise<MediaAsset> {
  let asset: ApiAsset
  try {
    asset = await apiFetch<ApiAsset>(path, {
      method: assigned ? 'PUT' : 'DELETE',
    })
  } catch (error) {
    if (assigned || !(error instanceof ApiError) || error.status !== 404)
      throw error
    asset = await apiFetch<ApiAsset>(localAssetPath(assetId))
  }
  await invalidateMedia()
  return toMediaAsset(asset)
}

export function setAssetTag(
  assetId: string,
  tagId: string,
  assigned: boolean,
): Promise<MediaAsset> {
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
): Promise<MediaAsset> {
  return setMembership(
    `${localAssetPath(assetId)}/collections/${encodeURIComponent(collectionId)}`,
    assetId,
    assigned,
  )
}

export async function createCollection(
  title: string,
): Promise<MediaCollection> {
  const collection = await apiFetch<MediaCollection>('/assetcollections', {
    method: 'POST',
    body: { title },
  })
  await invalidateMedia()
  return collection
}

export async function updateCollection(
  collectionId: string,
  title: string,
): Promise<MediaCollection> {
  const collection = await apiFetch<MediaCollection>(
    `/assetcollections/${encodeURIComponent(collectionId)}`,
    { method: 'PATCH', body: { title } },
  )
  await invalidateMedia()
  return collection
}

export async function deleteCollection(collectionId: string): Promise<void> {
  await apiFetch<null>(
    `/assetcollections/${encodeURIComponent(collectionId)}`,
    { method: 'DELETE' },
  )
  await invalidateMedia()
}

export async function createTag(
  label: string,
  parentId?: string | null,
): Promise<MediaTag> {
  const tag = await apiFetch<MediaTag>('/assettags', {
    method: 'POST',
    body: { label, parentId: parentId ?? null },
  })
  await invalidateMedia()
  return tag
}

/**
 * Rename and/or move a tag. parentId null moves it to the root; a key left
 * out stays as it is.
 */
export async function updateTag(
  tagId: string,
  patch: { label?: string; parentId?: string | null },
): Promise<MediaTag> {
  const tag = await apiFetch<MediaTag>(
    `/assettags/${encodeURIComponent(tagId)}`,
    { method: 'PATCH', body: patch },
  )
  await invalidateMedia()
  return tag
}

export async function deleteTag(tagId: string): Promise<void> {
  await apiFetch<null>(`/assettags/${encodeURIComponent(tagId)}`, {
    method: 'DELETE',
  })
  await invalidateMedia()
}
