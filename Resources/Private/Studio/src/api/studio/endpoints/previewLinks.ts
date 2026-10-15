import { useQuery } from '@tanstack/react-query'
import type { Listing } from '../../neos/client'
import type { NodeAddress } from '../../neos/schema'
import { nodeAddressOf } from '../../neos/schema'
import { studioFetch } from '../client'
import { studioKeys } from '../keys'
import type { NewPreviewLink, PreviewLink } from '../schema'

/** The account's own preview links (the anonymous side is the ShareController). */
export function usePreviewLinks(enabled = true) {
  return useQuery({
    queryKey: studioKeys.previewLinks,
    queryFn: () => studioFetch<Listing<PreviewLink>>('/previewlinks'),
    enabled,
    select: (listing) => listing.data,
  })
}

/** The new link with its share URL - the only time the URL is readable. */
export function createPreviewLink(
  node: NodeAddress,
  options: { label?: string; ttlHours?: number } = {},
): Promise<NewPreviewLink> {
  return studioFetch<NewPreviewLink>('/previewlinks', {
    method: 'POST',
    body: { ...nodeAddressOf(node), ...options },
  })
}

export function deletePreviewLink(id: string): Promise<null> {
  return studioFetch<null>(`/previewlinks/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}
