import { config } from '@/config'
import { type FetchInit, request, upload } from '../http/request'
import type { ListingLinks, ListingMeta } from './schema'

/** A request against Neos.Api below config.apiBase ('/api'). */
export function apiFetch<T>(path: string, init?: FetchInit): Promise<T> {
  return request<T>(config.apiBase, path, init)
}

/** A multipart upload against Neos.Api, with progress. */
export function apiUpload<T>(
  path: string,
  formData: FormData,
  options?: { method?: string; onProgress?: (fraction: number) => void },
): Promise<T> {
  return upload<T>(config.apiBase, path, formData, options)
}

/** A Neos.Api listing: a page of items with its meta and links. */
export interface Listing<T, M extends ListingMeta = ListingMeta> {
  data: T[]
  meta: M
  links?: ListingLinks
}

/** Neos.Api's maximum page size. */
export const MAX_PAGE_SIZE = 100

/**
 * Every item of a paginated Neos.Api listing: requests pages of the maximum
 * size and follows links.next until it runs out. For the lists the shell
 * needs in full (tree levels, changes, the user roster) - not for listings a
 * UI pages through itself (the media browser).
 *
 * `path` may carry a query; offset and limit are set here.
 */
export async function fetchAllPages<T>(path: string): Promise<T[]> {
  const separator = path.includes('?') ? '&' : '?'
  const items: T[] = []
  for (let offset = 0; ; offset += MAX_PAGE_SIZE) {
    const page = await apiFetch<Listing<T>>(
      `${path}${separator}offset=${offset}&limit=${MAX_PAGE_SIZE}`,
    )
    items.push(...page.data)
    if (!page.links?.next || offset + MAX_PAGE_SIZE >= page.meta.total) {
      return items
    }
  }
}

/** `/cr/{contentRepositoryId}` of the content repository the Studio edits. */
export function contentRepositoryPath(
  contentRepositoryId: string = config.contentRepositoryId,
): string {
  return `/cr/${encodeURIComponent(contentRepositoryId)}`
}
