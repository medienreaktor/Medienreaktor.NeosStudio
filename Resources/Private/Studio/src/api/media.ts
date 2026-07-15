import { useInfiniteQuery, useQuery } from '@tanstack/react-query'

import { queryClient } from '@/app/queryClient'
import { apiFetch, apiUpload } from './client'
import { queryKeys } from './keys'
import type { NodeDto } from './nodes'

export type AssetType = 'Image' | 'Document' | 'Video' | 'Audio'

export interface AssetTagRef {
  identifier: string
  label: string
}

export interface AssetCollectionRef {
  identifier: string
  title: string
}

/**
 * An asset as returned by the API, across all asset sources. The editable
 * metadata block (title/caption/copyrightNotice, tags, collections) is only
 * present for local Neos assets; remote proxies expose `iptc` instead.
 */
export interface MediaAsset {
  assetSource: string
  identifier: string
  localAssetIdentifier: string | null
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
  isImported: boolean
  isRemote: boolean
  isReadOnly: boolean
  // Local Neos assets only:
  title?: string
  caption?: string
  copyrightNotice?: string
  tags?: AssetTagRef[]
  collections?: AssetCollectionRef[]
  // Remote proxies only:
  iptc?: {
    title: string | null
    caption: string | null
    copyrightNotice: string | null
  }
}

export interface AssetSource {
  identifier: string
  label: string
  description: string
  iconUri: string
  isReadOnly: boolean
  supportsTagging: boolean
  supportsCollections: boolean
  supportsSorting: boolean
}

export interface MediaCollection {
  identifier: string
  title: string
  assetCount: number
}

export interface MediaTag {
  identifier: string
  label: string
  parent: string | null
  assetCount: number
  children: MediaTag[]
}

export interface AssetUsage {
  node: NodeDto
  documentNode: NodeDto | null
  workspaceName: string
  dimension: Record<string, string>
}

export interface AssetUsageResponse {
  usages: AssetUsage[]
  inaccessibleCount: number
  total: number
}

/** The controls the browser toolbar/sidebar drive the list with. */
export interface AssetListFilter {
  assetSource: string
  type: AssetType | 'All'
  search: string
  collection: string | null
  tag: string | null
  /** 'given' honours `tag`; 'none' lists untagged assets. */
  tagMode: 'given' | 'none'
  sortBy: 'modified' | 'name'
  sortDirection: 'asc' | 'desc'
}

export const DEFAULT_ASSET_FILTER: AssetListFilter = {
  assetSource: 'neos',
  type: 'All',
  search: '',
  collection: null,
  tag: null,
  tagMode: 'given',
  sortBy: 'modified',
  sortDirection: 'desc',
}

interface AssetListResponse {
  assets: MediaAsset[]
  pagination: { total: number; limit: number; offset: number }
}

const PAGE_SIZE = 40

function assetListQuery(filter: AssetListFilter, offset: number): string {
  const params = new URLSearchParams()
  params.set('assetSource', filter.assetSource)
  params.set('limit', String(PAGE_SIZE))
  params.set('offset', String(offset))
  if (filter.type !== 'All') params.set('type', filter.type)
  if (filter.search) params.set('search', filter.search)
  if (filter.collection) params.set('collection', filter.collection)
  if (filter.tagMode === 'none') params.set('tagMode', 'none')
  else if (filter.tag) params.set('tag', filter.tag)
  params.set('sortBy', filter.sortBy)
  params.set('sortDirection', filter.sortDirection)
  return params.toString()
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
    queryFn: ({ pageParam }) =>
      apiFetch<AssetListResponse>(
        `/media/assets?${assetListQuery(filter, pageParam)}`,
      ),
    initialPageParam: 0,
    getNextPageParam: (last) => {
      const next = last.pagination.offset + last.pagination.limit
      return next < last.pagination.total ? next : undefined
    },
    enabled,
  })
}

export function useAsset(
  assetSource: string,
  identifier: string | null,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.media.asset(assetSource, identifier ?? ''),
    queryFn: () =>
      apiFetch<{ asset: MediaAsset }>(
        `/media/assets/${encodeURIComponent(assetSource)}/${encodeURIComponent(identifier!)}`,
      ).then((r) => r.asset),
    enabled: enabled && identifier !== null,
  })
}

export function useAssetUsage(
  assetSource: string,
  identifier: string | null,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.media.assetUsage(assetSource, identifier ?? ''),
    queryFn: () =>
      apiFetch<AssetUsageResponse>(
        `/media/assets/${encodeURIComponent(assetSource)}/${encodeURIComponent(identifier!)}/usage`,
      ),
    enabled: enabled && identifier !== null,
  })
}

export function useAssetSources(enabled = true) {
  return useQuery({
    queryKey: queryKeys.media.sources,
    queryFn: () =>
      apiFetch<{ assetSources: AssetSource[] }>('/media/asset-sources').then(
        (r) => r.assetSources,
      ),
    enabled,
  })
}

export function useAssetCollections(enabled = true) {
  return useQuery({
    queryKey: queryKeys.media.collections,
    queryFn: () =>
      apiFetch<{ collections: MediaCollection[] }>('/media/collections').then(
        (r) => r.collections,
      ),
    enabled,
  })
}

export function useTags(enabled = true) {
  return useQuery({
    queryKey: queryKeys.media.tags,
    queryFn: () =>
      apiFetch<{ tags: MediaTag[] }>('/media/tags').then((r) => r.tags),
    enabled,
  })
}

// --- Writes (await-then-invalidate; no optimistic updates, matching the codebase) ---

/** Drop every cached media read. Called after any write. */
function invalidateMedia(): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: queryKeys.media.all })
}

export interface UploadOptions {
  collection?: string | null
  tags?: string[]
  onProgress?: (fraction: number) => void
}

export async function uploadAsset(
  file: File,
  options: UploadOptions = {},
): Promise<MediaAsset> {
  const form = new FormData()
  form.append('asset[resource]', file)
  if (options.collection) form.append('collection', options.collection)
  for (const tag of options.tags ?? []) form.append('tags[]', tag)

  const result = await apiUpload<{ asset: MediaAsset }>('/media/assets', form, {
    onProgress: options.onProgress,
  })
  await invalidateMedia()
  return result.asset
}

export interface AssetMetadataPatch {
  title?: string
  caption?: string
  copyrightNotice?: string
  tags?: string[]
  collections?: string[]
}

export async function updateAsset(
  identifier: string,
  patch: AssetMetadataPatch,
): Promise<MediaAsset> {
  const result = await apiFetch<{ asset: MediaAsset }>(
    `/media/assets/${encodeURIComponent(identifier)}`,
    {
      method: 'PATCH',
      body: patch,
    },
  )
  await invalidateMedia()
  return result.asset
}

export async function deleteAsset(identifier: string): Promise<void> {
  await apiFetch(`/media/assets/${encodeURIComponent(identifier)}`, {
    method: 'DELETE',
  })
  await invalidateMedia()
}

export async function replaceAssetResource(
  identifier: string,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<MediaAsset> {
  const form = new FormData()
  form.append('resource', file)
  const result = await apiUpload<{ asset: MediaAsset }>(
    `/media/assets/${encodeURIComponent(identifier)}/resource`,
    form,
    { onProgress },
  )
  await invalidateMedia()
  return result.asset
}

export async function importProxyAsset(
  assetSource: string,
  assetIdentifier: string,
): Promise<MediaAsset> {
  const result = await apiFetch<{ asset: MediaAsset }>('/media/assets/import', {
    method: 'POST',
    body: { assetSource, assetIdentifier },
  })
  await invalidateMedia()
  return result.asset
}

export async function setAssetTag(
  identifier: string,
  tag: string,
  assigned: boolean,
): Promise<MediaAsset> {
  const path = `/media/assets/${encodeURIComponent(identifier)}/tags`
  const result = assigned
    ? await apiFetch<{ asset: MediaAsset }>(path, {
        method: 'POST',
        body: { tag },
      })
    : await apiFetch<{ asset: MediaAsset }>(
        `${path}?tag=${encodeURIComponent(tag)}`,
        { method: 'DELETE' },
      )
  await invalidateMedia()
  return result.asset
}

export async function setAssetCollection(
  identifier: string,
  collection: string,
  assigned: boolean,
): Promise<MediaAsset> {
  const path = `/media/assets/${encodeURIComponent(identifier)}/collections`
  const result = assigned
    ? await apiFetch<{ asset: MediaAsset }>(path, {
        method: 'POST',
        body: { collection },
      })
    : await apiFetch<{ asset: MediaAsset }>(
        `${path}?collection=${encodeURIComponent(collection)}`,
        {
          method: 'DELETE',
        },
      )
  await invalidateMedia()
  return result.asset
}

export async function createCollection(
  title: string,
): Promise<MediaCollection> {
  const result = await apiFetch<{ collection: MediaCollection }>(
    '/media/collections',
    {
      method: 'POST',
      body: { title },
    },
  )
  await invalidateMedia()
  return result.collection
}

export async function updateCollection(
  identifier: string,
  title: string,
): Promise<MediaCollection> {
  const result = await apiFetch<{ collection: MediaCollection }>(
    `/media/collections/${encodeURIComponent(identifier)}`,
    { method: 'PATCH', body: { title } },
  )
  await invalidateMedia()
  return result.collection
}

export async function deleteCollection(identifier: string): Promise<void> {
  await apiFetch(`/media/collections/${encodeURIComponent(identifier)}`, {
    method: 'DELETE',
  })
  await invalidateMedia()
}

export async function createTag(
  label: string,
  parent?: string | null,
): Promise<MediaTag> {
  const result = await apiFetch<{ tag: MediaTag }>('/media/tags', {
    method: 'POST',
    body: { label, parent: parent ?? null },
  })
  await invalidateMedia()
  return result.tag
}

export async function updateTag(
  identifier: string,
  patch: { label?: string; parent?: string | null },
): Promise<MediaTag> {
  const result = await apiFetch<{ tag: MediaTag }>(
    `/media/tags/${encodeURIComponent(identifier)}`,
    {
      method: 'PATCH',
      body: patch,
    },
  )
  await invalidateMedia()
  return result.tag
}

export async function deleteTag(identifier: string): Promise<void> {
  await apiFetch(`/media/tags/${encodeURIComponent(identifier)}`, {
    method: 'DELETE',
  })
  await invalidateMedia()
}
