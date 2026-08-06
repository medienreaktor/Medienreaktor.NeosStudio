import { useQuery } from '@tanstack/react-query'
import { apiFetch } from './client'
import { queryKeys } from './keys'

/**
 * Shareable preview links: a URL secret granting anonymous, read-only,
 * frontend-mode access to one document until the link expires (see
 * PreviewLinksController / ShareController). The secret is stored hashed
 * server-side, so shareUrl exists exactly once - in the create response.
 */

/** One link, as served by GET /api/preview-links (no URL - see above). */
export interface PreviewLink {
  id: string
  label: string
  /** The pinned document (base64url node address, workspace + dimension included). */
  node: string
  workspaceName: string
  createdAt: string
  expiresAt: string
}

/** The create response carries the one-time full URL on top. */
export interface CreatedPreviewLink extends PreviewLink {
  shareUrl: string
}

export function usePreviewLinks(enabled = true) {
  return useQuery({
    queryKey: queryKeys.previewLinks,
    queryFn: () => apiFetch<{ links: PreviewLink[] }>('/preview-links'),
    enabled,
  })
}

export function createPreviewLink(input: {
  node: string
  label?: string
  ttlHours?: number
}): Promise<{ link: CreatedPreviewLink }> {
  return apiFetch<{ link: CreatedPreviewLink }>('/preview-links', {
    method: 'POST',
    body: input,
  })
}

export function deletePreviewLink(id: string): Promise<{ revoked: string }> {
  return apiFetch<{ revoked: string }>(
    `/preview-links/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  )
}
