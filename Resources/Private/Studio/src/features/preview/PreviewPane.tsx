import { useState } from 'react'
import { ExternalLink, RotateCw } from 'lucide-react'
import type { NodeDto } from '@/api/nodes'
import { Button } from '@/components/ui/button'
import { config } from '@/config'

/**
 * URL of the Studio's own preview endpoint for a node. The address already
 * encodes the complete identity - workspace, dimension space point and
 * aggregate id - so the combination to preview is explicit in the URL.
 * An optional rendering mode (e.g. "inPlace") requests the content-element
 * metadata markup needed later for click-to-select and in-place editing.
 */
export function previewUrl(address: string, mode?: string): string {
  const params = new URLSearchParams({ node: address })
  if (mode) params.set('mode', mode)
  return `${config.previewBase}?${params}`
}

/**
 * Renders the selected document as visitors would see it. The iframe is
 * same-origin and authenticated by the backend session, not the OAuth token.
 */
export function PreviewPane({ document }: { document: NodeDto | null }) {
  // Remount key: bumping it reloads the iframe even though the src string is
  // unchanged (e.g. after edits in the same document).
  const [reloadCount, setReloadCount] = useState(0)

  if (!document) {
    return (
      <div className="grid flex-1 place-items-center p-6">
        <p className="text-sm text-muted-foreground">Select a document to preview it.</p>
      </div>
    )
  }

  const src = previewUrl(document.address)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-end gap-1 border-b px-2 py-1">
        <Button
          variant="ghost"
          size="icon-xs"
          title="Reload preview"
          onClick={() => setReloadCount((count) => count + 1)}
        >
          <RotateCw />
        </Button>
        <Button asChild variant="ghost" size="icon-xs" title="Open preview in a new tab">
          <a href={src} target="_blank" rel="noreferrer">
            <ExternalLink />
          </a>
        </Button>
      </div>
      <iframe
        key={`${document.address}:${reloadCount}`}
        src={src}
        title="Page preview"
        className="min-h-0 w-full flex-1 border-0 bg-white"
      />
    </div>
  )
}
