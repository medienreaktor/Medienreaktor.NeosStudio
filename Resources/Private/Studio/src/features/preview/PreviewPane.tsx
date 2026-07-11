import { useEffect, useRef, useState } from 'react'
import { ExternalLink, Eye, Pencil, RotateCw } from 'lucide-react'
import { addressFromContextPath, decodeNodeAddress } from '@/api/nodeAddress'
import type { NodeDto } from '@/api/nodes'
import { Button } from '@/components/ui/button'
import { config } from '@/config'
import { persistPropertyChange } from '@/features/editing/persistProperty'
import type { GuestToHostMessage, HostToGuestMessage } from './protocol'

/**
 * URL of the Studio's own preview endpoint for a node. The address already
 * encodes the complete identity - workspace, dimension space point and
 * aggregate id - so the combination to preview is explicit in the URL.
 * The "inPlace" rendering mode requests the content-element metadata markup
 * the guest script needs for click-to-select and inline editing.
 */
export function previewUrl(address: string, mode?: string): string {
  const params = new URLSearchParams({ node: address })
  if (mode) params.set('mode', mode)
  return `${config.previewBase}?${params}`
}

/**
 * Renders the selected document in an iframe and bridges it to the shell:
 * clicks on content elements surface as onSelectNode (the outliner follows),
 * the shell's selection is pushed back as an outline, and inline edits are
 * persisted through the commands API. The iframe is same-origin and
 * authenticated by the backend session, not the OAuth token.
 */
export function PreviewPane({
  document,
  selectedAddress,
  onSelectNode,
  onNavigateToNode,
  onNodeEdited,
  reloadToken = 0,
}: {
  document: NodeDto | null
  /** Address outlined in the preview - the node inspected in the shell. */
  selectedAddress: string | null
  /** A content element was clicked in the preview. */
  onSelectNode: (address: string) => void
  /** A link to another document was followed in the preview. */
  onNavigateToNode?: (address: string) => void
  /** An inline edit for this address was persisted. */
  onNodeEdited?: (address: string) => void
  /** Bump to reload the iframe after edits made outside of it (e.g. the inspector). */
  reloadToken?: number
}) {
  // Remount key: bumping it reloads the iframe even though the src string is
  // unchanged (e.g. after edits in the same document).
  const [reloadCount, setReloadCount] = useState(0)
  const [editing, setEditing] = useState(true)
  const [guestReady, setGuestReady] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  // Latest-callback refs keep the message listener subscription stable.
  const onSelectNodeRef = useRef(onSelectNode)
  onSelectNodeRef.current = onSelectNode
  const onNavigateToNodeRef = useRef(onNavigateToNode)
  onNavigateToNodeRef.current = onNavigateToNode
  const onNodeEditedRef = useRef(onNodeEdited)
  onNodeEditedRef.current = onNodeEdited

  const src = document ? previewUrl(document.address, editing ? 'inPlace' : undefined) : null

  // A new iframe document means a new guest lifecycle.
  useEffect(() => {
    setGuestReady(false)
  }, [src, reloadCount, reloadToken])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return
      const message = event.data as GuestToHostMessage
      switch (message?.type) {
        case 'neos-studio/guest-ready':
          setGuestReady(true)
          break
        case 'neos-studio/node-selected':
          try {
            onSelectNodeRef.current(addressFromContextPath(message.contextPath))
          } catch {
            /* malformed contextpath - ignore the click */
          }
          break
        case 'neos-studio/navigate-to-node':
          try {
            onNavigateToNodeRef.current?.(addressFromContextPath(message.contextPath))
          } catch {
            /* malformed contextpath - ignore the navigation */
          }
          break
        case 'neos-studio/property-changed': {
          const address = addressFromContextPath(message.contextPath)
          setSaveError(null)
          persistPropertyChange(address, message.property, message.value)
            .then(() => onNodeEditedRef.current?.(address))
            .catch((e: unknown) => setSaveError(e instanceof Error ? e.message : String(e)))
          break
        }
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // Push the shell's selection into the guest (also right after it boots).
  useEffect(() => {
    if (!guestReady) return
    const frame = iframeRef.current?.contentWindow
    if (!frame) return
    const message: HostToGuestMessage = {
      type: 'neos-studio/select-node',
      aggregateId: selectedAddress === null ? null : decodeNodeAddress(selectedAddress).aggregateId,
    }
    frame.postMessage(message, window.location.origin)
  }, [guestReady, selectedAddress])

  if (!document || !src) {
    return (
      <div className="grid flex-1 place-items-center p-6">
        <p className="text-sm text-muted-foreground">Select a document to preview it.</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-end gap-1 border-b px-2 py-1">
        {saveError && (
          <span className="mr-auto overflow-hidden text-ellipsis whitespace-nowrap px-2 text-xs text-destructive">
            Saving failed: {saveError}
          </span>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          title={editing ? 'Preview without editing' : 'Edit in place'}
          onClick={() => setEditing((value) => !value)}
        >
          {editing ? <Eye /> : <Pencil />}
        </Button>
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
        ref={iframeRef}
        key={`${src}:${reloadCount}:${reloadToken}`}
        src={src}
        title="Page preview"
        className="min-h-0 w-full flex-1 border-0 bg-white"
      />
    </div>
  )
}
