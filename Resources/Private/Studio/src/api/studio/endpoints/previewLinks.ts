import { useQuery } from '@tanstack/react-query'
import type { NodeAddress } from '../../neos/schema'
import { nodeAddressOf } from '../../neos/schema'
import { studioFetch } from '../client'
import { studioKeys } from '../keys'
import type { CreatedPreviewLink, PreviewLink } from '../schema'

/** The account's own preview links (see PreviewLinksController / ShareController). */
export function usePreviewLinks(enabled = true) {
  return useQuery({
    queryKey: studioKeys.previewLinks,
    queryFn: () => studioFetch<{ links: PreviewLink[] }>('/preview-links'),
    enabled,
    select: (response) => response.links,
  })
}

export function createPreviewLink(
  node: NodeAddress,
  options: { label?: string; ttlHours?: number } = {},
): Promise<{ link: CreatedPreviewLink }> {
  return studioFetch<{ link: CreatedPreviewLink }>('/preview-links', {
    method: 'POST',
    body: { ...nodeAddressOf(node), ...options },
  })
}

export function deletePreviewLink(id: string): Promise<{ revoked: string }> {
  return studioFetch<{ revoked: string }>(
    `/preview-links/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  )
}
