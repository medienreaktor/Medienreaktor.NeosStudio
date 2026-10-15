import { skipToken, useQuery } from '@tanstack/react-query'
import { api, unwrap } from '../../neos/client'
import type { NodeAddress } from '../../neos/schema'
import { nodeAddressOf } from '../../neos/schema'
import { studioKeys } from '../keys'
import type { NewPreviewLink, PreviewLinkCreate } from '../schema'

/** The account's own preview links (the anonymous side is the ShareController). */
export function usePreviewLinks(enabled = true) {
  return useQuery({
    queryKey: studioKeys.previewLinks,
    queryFn: enabled
      ? ({ signal }) => unwrap(api.GET('/previewlinks', { signal }))
      : skipToken,
    select: (listing) => listing.data,
  })
}

/** The new link with its share URL - the only time the URL is readable. */
export function createPreviewLink(
  node: NodeAddress,
  options: { label?: string; ttlHours?: number } = {},
): Promise<NewPreviewLink> {
  return unwrap(
    api.POST('/previewlinks', {
      body: { ...nodeAddressOf(node), ...options } satisfies PreviewLinkCreate,
    }),
  )
}

export async function deletePreviewLink(id: string): Promise<void> {
  await unwrap(
    api.DELETE('/previewlinks/{previewLinkId}', {
      params: { path: { previewLinkId: id } },
    }),
  )
}
