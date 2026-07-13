import { useEffect, useRef, useState } from 'react'
import { ExternalLink, Eye, Pencil, RotateCw } from 'lucide-react'
import { addressFromContextPath, decodeNodeAddress } from '@/api/nodeAddress'
import type { NodeDto } from '@/api/nodes'
import { useNodeTypes } from '@/api/nodeTypes'
import { Button } from '@/components/ui/button'
import { config } from '@/config'
import type { CreateNodeRequest } from '@/features/creation/createNode'
import { type CreationDrag, getCreationDrag, subscribeCreationDrag } from '@/features/creation/creationDrag'
import { CreateNodeFlow } from '@/features/creation/NodeCreationDialog'
import { moveNode } from '@/features/editing/nodeActions'
import { NodeContextMenu, type NodeMenuTarget } from '@/features/editing/NodeContextMenu'
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
 * Preview controls for the topbar: toggle in-place editing, reload the
 * iframe and open the page in a new tab. The external link always uses the
 * plain preview rendering - the content-element metadata of the "inPlace"
 * mode only makes sense inside the shell's iframe.
 */
export function PreviewToolbar({
  document,
  editing,
  onToggleEditing,
  onReload,
}: {
  document: NodeDto | null
  editing: boolean
  onToggleEditing: () => void
  onReload: () => void
}) {
  if (!document) return null
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon-xs"
        title={editing ? 'Preview without editing' : 'Edit in place'}
        onClick={onToggleEditing}
      >
        {editing ? <Eye /> : <Pencil />}
      </Button>
      <Button variant="ghost" size="icon-xs" title="Reload preview" onClick={onReload}>
        <RotateCw />
      </Button>
      <Button asChild variant="ghost" size="icon-xs" title="Open page in a new tab">
        <a href={previewUrl(document.address)} target="_blank" rel="noreferrer">
          <ExternalLink />
        </a>
      </Button>
    </div>
  )
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
  editing,
  selectedAddress,
  onSelectNode,
  onNavigateToNode,
  onNodeEdited,
  reloadToken = 0,
}: {
  document: NodeDto | null
  /** Render with in-place editing (owned by the shell's PreviewToolbar). */
  editing: boolean
  /** Address outlined in the preview - the node inspected in the shell. */
  selectedAddress: string | null
  /** A content element was clicked in the preview. */
  onSelectNode: (address: string) => void
  /** A link to another document was followed in the preview. */
  onNavigateToNode?: (address: string) => void
  /** An edit for these addresses was persisted (structural edits touch several). */
  onNodeEdited?: (address: string | string[]) => void
  /** Bump to reload the iframe after edits made outside of it (e.g. the inspector). */
  reloadToken?: number
}) {
  // Remount key: bumping it reloads the iframe even though the src string is
  // unchanged (e.g. after edits in the same document).
  const [reloadCount, setReloadCount] = useState(0)
  const [guestReady, setGuestReady] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  // A drop from the creation panel landed in the preview - the creation flow
  // (optional creation dialog + command) runs for this insertion point.
  const [pendingCreation, setPendingCreation] = useState<CreateNodeRequest | null>(null)
  // The element menu (hide/unhide/delete) requested via the "..." handle in
  // the guest, anchored at the handle's viewport position over the iframe.
  const [elementMenu, setElementMenu] = useState<NodeMenuTarget | null>(null)
  const { data: nodeTypes } = useNodeTypes()
  const iframeRef = useRef<HTMLIFrameElement>(null)

  // Latest-callback refs keep the message listener subscription stable.
  const onSelectNodeRef = useRef(onSelectNode)
  onSelectNodeRef.current = onSelectNode
  const onNavigateToNodeRef = useRef(onNavigateToNode)
  onNavigateToNodeRef.current = onNavigateToNode
  const onNodeEditedRef = useRef(onNodeEdited)
  onNodeEditedRef.current = onNodeEdited

  const src = document ? previewUrl(document.address, editing ? 'inPlace' : undefined) : null

  // A new iframe document means a new guest lifecycle; a menu anchored in
  // the previous document has nothing to point at anymore.
  useEffect(() => {
    setGuestReady(false)
    setElementMenu(null)
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
            .catch((e: unknown) => setSaveError(`Saving failed: ${e instanceof Error ? e.message : String(e)}`))
          break
        }
        case 'neos-studio/create-node-request':
          setSaveError(null)
          setPendingCreation({
            nodeTypeName: message.nodeTypeName,
            parentContextPath: message.parentContextPath,
            succeedingSiblingContextPath: message.succeedingSiblingContextPath,
          })
          break
        case 'neos-studio/element-menu-request': {
          const frameRect = iframeRef.current?.getBoundingClientRect()
          if (!frameRect) break
          try {
            const address = addressFromContextPath(message.contextPath)
            const parentAddress = message.parentContextPath
              ? addressFromContextPath(message.parentContextPath)
              : null
            // A second click on the same handle closes the menu (toggle).
            setElementMenu((previous) =>
              previous?.address === address
                ? null
                : {
                    address,
                    parentAddress,
                    hidden: message.hidden,
                    tethered: false,
                    anchor: {
                      x: frameRect.left + message.buttonRect.left,
                      y: frameRect.top + message.buttonRect.top,
                      width: message.buttonRect.width,
                      height: message.buttonRect.height,
                    },
                  },
            )
          } catch {
            /* malformed contextpath - ignore the request */
          }
          break
        }
        case 'neos-studio/move-node-request': {
          setSaveError(null)
          try {
            const targetAddress = addressFromContextPath(message.parentContextPath)
            const sourceAddress = message.sourceParentContextPath
              ? addressFromContextPath(message.sourceParentContextPath)
              : null
            moveNode(message)
              .then(() => {
                // The moved element renders in its new place after a reload;
                // both affected collections refresh in the outliner. The
                // selection stays on the moved node.
                setReloadCount((count) => count + 1)
                const parents =
                  sourceAddress && sourceAddress !== targetAddress
                    ? [targetAddress, sourceAddress]
                    : [targetAddress]
                onNodeEditedRef.current?.(parents)
              })
              .catch((e: unknown) =>
                setSaveError(`Moving failed: ${e instanceof Error ? e.message : String(e)}`),
              )
          } catch {
            /* malformed contextpath - ignore the drop */
          }
          break
        }
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // Announce node-type drags from the creation panel to the guest, which
  // marks the collections allowing that type as drop targets. A drag can
  // already be underway when the guest (re)boots - push the current state.
  useEffect(() => {
    if (!guestReady) return
    const frame = iframeRef.current?.contentWindow
    if (!frame) return
    const send = (drag: CreationDrag) => {
      const message: HostToGuestMessage = drag
        ? { type: 'neos-studio/creation-drag-start', nodeTypeName: drag.nodeTypeName }
        : { type: 'neos-studio/creation-drag-end' }
      frame.postMessage(message, window.location.origin)
    }
    const current = getCreationDrag()
    if (current) send(current)
    return subscribeCreationDrag(send)
  }, [guestReady])

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
      {saveError && (
        <div className="overflow-hidden text-ellipsis whitespace-nowrap border-b px-4 py-1 text-xs text-destructive">
          {saveError}
        </div>
      )}
      <iframe
        ref={iframeRef}
        key={`${src}:${reloadCount}:${reloadToken}`}
        src={src}
        title="Page preview"
        className="min-h-0 w-full flex-1 border-0 bg-white"
      />
      <NodeContextMenu
        target={elementMenu}
        entityLabel="element"
        onClose={() => setElementMenu(null)}
        onDone={(action, target) => {
          setSaveError(null)
          // Every action renders only after a reload. Hide/unhide keep the
          // node inspected (with a fresh snapshot); a delete moves the
          // inspection to the enclosing collection - the deleted node has no
          // data to inspect anymore.
          setReloadCount((count) => count + 1)
          if (action === 'delete') {
            if (target.parentAddress) onSelectNodeRef.current(target.parentAddress)
            onNodeEditedRef.current?.(target.parentAddress ? [target.parentAddress] : [])
          } else {
            onNodeEditedRef.current?.(target.address)
            onSelectNodeRef.current(target.address)
          }
        }}
        onError={setSaveError}
      />
      {pendingCreation && (
        <CreateNodeFlow
          request={pendingCreation}
          nodeTypes={nodeTypes}
          onCreated={(address) => {
            const parentAddress = addressFromContextPath(pendingCreation.parentContextPath)
            setPendingCreation(null)
            // The new node only renders after a reload; the shell then
            // refreshes the outliner below the collection and inspects the
            // new node (which also outlines it in the reloaded preview).
            setReloadCount((count) => count + 1)
            onNodeEditedRef.current?.(parentAddress)
            onSelectNodeRef.current(address)
          }}
          onCancel={(error) => {
            setPendingCreation(null)
            if (error) setSaveError(`Creating failed: ${error}`)
          }}
        />
      )}
    </div>
  )
}
