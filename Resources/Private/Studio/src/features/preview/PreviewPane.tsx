import { useEffect, useRef, useState } from 'react'
import { addressFromContextPath, decodeNodeAddress } from '@/api/nodeAddress'
import { renderNodeElement, type NodeDto } from '@/api/nodes'
import { useNodeTypes } from '@/api/nodeTypes'
import { toast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Placeholder } from '@/components/ui/placeholder'
import { config } from '@/config'
import type { CreateNodeRequest } from '@/features/creation/createNode'
import {
  type CreationDrag,
  getCreationDrag,
  subscribeCreationDrag,
} from '@/features/creation/creationDrag'
import { CreateNodeFlow } from '@/features/creation/NodeCreationDialog'
import { moveNode } from '@/features/editing/nodeActions'
import {
  NodeContextMenu,
  type NodeMenuTarget,
} from '@/features/editing/NodeContextMenu'
import {
  createVariant,
  persistPropertyChange,
} from '@/features/editing/persistProperty'
import { useAssetPicker } from '@/features/media/AssetPicker'
import { imageReference, localIdentifierFor } from '@/api/assetValue'
import { LinkEditorDialog } from '@/features/links/LinkEditorDialog'
import {
  linkAttributesFrom,
  linkValueFromAttributes,
} from '@/features/links/linkValue'
import type {
  GuestToHostMessage,
  HostToGuestMessage,
  LinkAttributes,
} from './protocol'

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
 * Preview controls for the topbar: reload the
 * iframe and open the page in a new tab. The external link always uses the
 * plain preview rendering - the content-element metadata of the "inPlace"
 * mode only makes sense inside the shell's iframe.
 */
export function PreviewToolbar({
  document,
  onReload,
}: {
  document: NodeDto | null
  onReload: () => void
}) {
  if (!document) return null
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon-xs"
        title="Reload preview"
        onClick={onReload}
      >
        <i className="fas fa-rotate text-xs" aria-hidden />
      </Button>
      <Button
        asChild
        variant="ghost"
        size="icon-xs"
        title="Open page in a new tab"
      >
        <a href={previewUrl(document.address)} target="_blank" rel="noreferrer">
          <i
            className="fas fa-arrow-up-right-from-square text-xs"
            aria-hidden
          />
        </a>
      </Button>
    </div>
  )
}

/**
 * One stacked preview iframe. Navigations and reloads mount a fresh layer on
 * top of the current one and fade it in once its guest is ready, so a page
 * swap crossfades instead of flashing white through a torn-down iframe.
 */
type PreviewLayer = {
  /** Stable identity, so React keeps (never remounts) the element. */
  id: number
  src: string
  /** src plus the reload counters - a change means "load a fresh frame". */
  loadKey: string
  /** The guest booted; the layer is faded in and takes over the bridge. */
  ready: boolean
}

/** Matches the iframe's opacity transition - lower layers retire after it. */
const CROSSFADE_MS = 50

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
  elementUpdate = null,
}: {
  document: NodeDto | null
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
  /**
   * Bump the token to refresh just this node's rendered element in place
   * (an inspector edit with ui.reloadIfChanged): the element is re-rendered
   * out-of-band and swapped into the live page - no iframe reload, scroll
   * position and inline editing elsewhere survive. Falls back to a full
   * reload whenever the element cannot be updated in place.
   */
  elementUpdate?: { address: string; token: number } | null
}) {
  // Bumping this reloads the preview even when the src is unchanged (e.g.
  // after edits in the same document); it feeds into a layer's load key.
  const [reloadCount, setReloadCount] = useState(0)
  const [guestReady, setGuestReady] = useState(false)
  // A drop from the creation panel landed in the preview - the creation flow
  // (optional creation dialog + command) runs for this insertion point.
  const [pendingCreation, setPendingCreation] =
    useState<CreateNodeRequest | null>(null)
  // The element menu (hide/unhide/delete) requested via the "..." handle in
  // the guest, anchored at the handle's viewport position over the iframe.
  const [elementMenu, setElementMenu] = useState<NodeMenuTarget | null>(null)
  // A pending rich-text link edit from the guest: the Link Editor dialog is
  // open for it, and the guest waits for link-apply / link-cancel.
  const [linkEdit, setLinkEdit] = useState<{
    attributes: LinkAttributes | null
  } | null>(null)
  const { data: nodeTypes } = useNodeTypes()
  // Opening the Media Library picker for an image clicked in the preview.
  const { requestPick } = useAssetPicker()
  const requestPickRef = useRef(requestPick)
  requestPickRef.current = requestPick

  // Double-buffered iframes stacked front-to-back: the last layer is the
  // incoming/active one, earlier layers are the outgoing page still painted
  // beneath it during the crossfade.
  const [layers, setLayers] = useState<PreviewLayer[]>([])
  // Live iframe elements by layer id, for identifying message senders and
  // for posting to the active frame.
  const framesRef = useRef(new Map<number, HTMLIFrameElement>())
  // The topmost ready frame - the one the shell bridges to.
  const activeFrameRef = useRef<HTMLIFrameElement | null>(null)
  const nextLayerIdRef = useRef(0)

  // Latest-callback refs keep the message listener subscription stable.
  const onSelectNodeRef = useRef(onSelectNode)
  onSelectNodeRef.current = onSelectNode
  const documentAddressRef = useRef(document?.address ?? null)
  documentAddressRef.current = document?.address ?? null
  const onNavigateToNodeRef = useRef(onNavigateToNode)
  onNavigateToNodeRef.current = onNavigateToNode
  const onNodeEditedRef = useRef(onNodeEdited)
  onNodeEditedRef.current = onNodeEdited

  // Replies (element-info / element-replaced) to requests the shell sent
  // into the guest, resolved by requestId from the message listener below.
  const pendingGuestRepliesRef = useRef(
    new Map<number, (message: GuestToHostMessage) => void>(),
  )
  const nextRequestIdRef = useRef(0)
  const awaitGuestReply = (
    requestId: number,
    timeoutMs: number,
  ): Promise<GuestToHostMessage | null> =>
    new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingGuestRepliesRef.current.delete(requestId)
        resolve(null)
      }, timeoutMs)
      pendingGuestRepliesRef.current.set(requestId, (message) => {
        clearTimeout(timer)
        pendingGuestRepliesRef.current.delete(requestId)
        resolve(message)
      })
    })

  const src = document ? previewUrl(document.address, 'inPlace') : null
  const loadKey = src ? `${src}#${reloadCount}#${reloadToken}` : null

  // A new load means a new guest lifecycle; a menu anchored in the previous
  // document has nothing to point at anymore - nor has a pending link edit.
  useEffect(() => {
    setGuestReady(false)
    setElementMenu(null)
    setLinkEdit(null)
  }, [loadKey])

  // Start a new frame whenever the load key changes. We keep only the most
  // recent ready layer as the fading-out background plus the new incoming
  // layer, so at most two iframes are ever live.
  useEffect(() => {
    if (!loadKey || !src) return
    const id = ++nextLayerIdRef.current
    setLayers((previous) => {
      if (previous[previous.length - 1]?.loadKey === loadKey) return previous
      const background = previous.filter((layer) => layer.ready).slice(-1)
      return [...background, { id, src, loadKey, ready: false }]
    })
  }, [loadKey, src])

  // Once the incoming (topmost) layer's guest is ready it becomes the bridge
  // target and fades in; after the crossfade the layers beneath it retire.
  useEffect(() => {
    const top = layers[layers.length - 1]
    if (!top?.ready) return
    activeFrameRef.current = framesRef.current.get(top.id) ?? null
    setGuestReady(true)
    if (layers.length <= 1) return
    const timer = setTimeout(() => {
      setLayers((previous) => {
        const index = previous.findIndex((layer) => layer.id === top.id)
        return index > 0 ? previous.slice(index) : previous
      })
    }, CROSSFADE_MS)
    return () => clearTimeout(timer)
  }, [layers])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      // Only messages from one of our live preview frames are trusted.
      let sourceId: number | null = null
      for (const [id, frame] of framesRef.current) {
        if (frame.contentWindow === event.source) {
          sourceId = id
          break
        }
      }
      if (sourceId === null) return
      const message = event.data as GuestToHostMessage
      switch (message?.type) {
        case 'neos-studio/guest-ready':
          setLayers((previous) =>
            previous.map((layer) =>
              layer.id === sourceId ? { ...layer, ready: true } : layer,
            ),
          )
          break
        case 'neos-studio/node-selected':
          try {
            onSelectNodeRef.current(addressFromContextPath(message.contextPath))
          } catch {
            /* malformed contextpath - ignore the click */
          }
          break
        case 'neos-studio/document-selected':
          // A click outside every content element inspects the document
          // itself - matching a click on the document in the tree.
          if (documentAddressRef.current)
            onSelectNodeRef.current(documentAddressRef.current)
          break
        case 'neos-studio/navigate-to-node':
          try {
            onNavigateToNodeRef.current?.(
              addressFromContextPath(message.contextPath),
            )
          } catch {
            /* malformed contextpath - ignore the navigation */
          }
          break
        case 'neos-studio/property-changed': {
          const address = addressFromContextPath(message.contextPath)
          persistPropertyChange(address, message.property, message.value)
            .then(() => onNodeEditedRef.current?.(address))
            .catch((e: unknown) => toast.error(e, { title: 'Saving failed' }))
          break
        }
        case 'neos-studio/create-node-request':
          setPendingCreation({
            nodeTypeName: message.nodeTypeName,
            parentContextPath: message.parentContextPath,
            succeedingSiblingContextPath: message.succeedingSiblingContextPath,
          })
          break
        case 'neos-studio/element-menu-request': {
          const frameRect = activeFrameRef.current?.getBoundingClientRect()
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
        case 'neos-studio/link-edit-request':
          setLinkEdit({ attributes: message.attributes })
          break
        case 'neos-studio/element-info':
        case 'neos-studio/element-replaced':
          pendingGuestRepliesRef.current.get(message.requestId)?.(message)
          break
        case 'neos-studio/create-variant-request': {
          // The "Create variant" button over a shine-through element: run the
          // CreateNodeVariant an edit would trigger implicitly, then reload -
          // the element renders without the fallback pattern afterwards.
          let address: string
          try {
            address = addressFromContextPath(message.contextPath)
          } catch {
            break
          }
          createVariant(address)
            .then(() => {
              toast.success('Variant created in the current dimension.')
              setReloadCount((count) => count + 1)
              onNodeEditedRef.current?.(address)
              onSelectNodeRef.current(address)
            })
            .catch((e: unknown) =>
              toast.error(e, { title: 'Creating the variant failed' }),
            )
          break
        }
        case 'neos-studio/image-select-request': {
          let address: string
          try {
            address = addressFromContextPath(message.contextPath)
          } catch {
            break
          }
          const property = message.property
          // Hand off to the Media Library picker; on pick, resolve the chosen
          // asset to a local identifier, set the image property, and reload the
          // preview so the new image renders.
          requestPickRef.current({
            title: property,
            onPick: (asset) => {
              localIdentifierFor(asset)
                .then((id) =>
                  persistPropertyChange(address, property, imageReference(id)),
                )
                .then(() => {
                  setReloadCount((count) => count + 1)
                  onNodeEditedRef.current?.(address)
                  // Inspect the edited node so the reloaded preview scrolls it
                  // into view (the shell pushes the selection to the fresh
                  // guest, which reveals it) - as an inspector edit does.
                  onSelectNodeRef.current(address)
                })
                .catch((e: unknown) =>
                  toast.error(e, { title: 'Setting image failed' }),
                )
            },
          })
          break
        }
        case 'neos-studio/move-node-request': {
          try {
            const targetAddress = addressFromContextPath(
              message.parentContextPath,
            )
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
              .catch((e: unknown) => toast.error(e, { title: 'Moving failed' }))
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
    const frame = activeFrameRef.current?.contentWindow
    if (!frame) return
    const send = (drag: CreationDrag) => {
      const message: HostToGuestMessage = drag
        ? {
            type: 'neos-studio/creation-drag-start',
            nodeTypeName: drag.nodeTypeName,
          }
        : { type: 'neos-studio/creation-drag-end' }
      frame.postMessage(message, window.location.origin)
    }
    const current = getCreationDrag()
    if (current) send(current)
    return subscribeCreationDrag(send)
  }, [guestReady])

  // Answer the guest that asked for the Link Editor (the pending link edit
  // lives in its rich-text editor).
  const postToGuest = (message: HostToGuestMessage) => {
    activeFrameRef.current?.contentWindow?.postMessage(
      message,
      window.location.origin,
    )
  }

  // Push the shell's selection into the guest (also right after it boots).
  useEffect(() => {
    if (!guestReady) return
    const frame = activeFrameRef.current?.contentWindow
    if (!frame) return
    const message: HostToGuestMessage = {
      type: 'neos-studio/select-node',
      aggregateId:
        selectedAddress === null
          ? null
          : decodeNodeAddress(selectedAddress).aggregateId,
    }
    frame.postMessage(message, window.location.origin)
  }, [guestReady, selectedAddress])

  // Out-of-band element update: re-render one node's element on the server
  // and swap it into the live page instead of reloading the iframe (the
  // ui.reloadIfChanged semantics; also hide/unhide of content elements).
  // Every failure along the way - guest not ready, node not rendered on this
  // page (e.g. a document), render error, swap failure, timeout - falls back
  // to a full reload: correctness first, the optimization is best-effort.
  const updateElementOutOfBand = async (address: string): Promise<void> => {
    const fallback = () => setReloadCount((count) => count + 1)
    const frame = activeFrameRef.current?.contentWindow
    if (!frame || !guestReady) return fallback()
    let aggregateId: string
    try {
      aggregateId = decodeNodeAddress(address).aggregateId
    } catch {
      return fallback()
    }
    const infoRequestId = ++nextRequestIdRef.current
    const infoRequest: HostToGuestMessage = {
      type: 'neos-studio/element-info-request',
      requestId: infoRequestId,
      aggregateId,
    }
    frame.postMessage(infoRequest, window.location.origin)
    const info = await awaitGuestReply(infoRequestId, 3000)
    if (info?.type !== 'neos-studio/element-info' || !info.fusionPath) {
      return fallback()
    }
    let html: string
    try {
      html = await renderNodeElement(address, info.fusionPath)
    } catch {
      return fallback()
    }
    const replaceRequestId = ++nextRequestIdRef.current
    const replaceRequest: HostToGuestMessage = {
      type: 'neos-studio/replace-element',
      requestId: replaceRequestId,
      aggregateId,
      html,
    }
    activeFrameRef.current?.contentWindow?.postMessage(
      replaceRequest,
      window.location.origin,
    )
    const ack = await awaitGuestReply(replaceRequestId, 3000)
    if (ack?.type !== 'neos-studio/element-replaced' || !ack.ok) fallback()
  }

  const update = elementUpdate ?? undefined
  useEffect(() => {
    if (!update) return
    void updateElementOutOfBand(update.address)
    // Only a new update (token) triggers a pass - the other values are read
    // fresh when it runs; a re-run on guestReady flips would replay old edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [update?.token])

  if (!document || !src) {
    return (
      <Placeholder
        icon="fa-file-lines"
        title="Select a document to preview it."
      />
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative min-h-0 w-full flex-1">
        {layers.map((layer) => (
          <iframe
            key={layer.id}
            ref={(element) => {
              if (element) framesRef.current.set(layer.id, element)
              else framesRef.current.delete(layer.id)
            }}
            src={layer.src}
            title="Page preview"
            // Until it is ready the incoming frame is invisible on top - keep
            // clicks flowing to the outgoing frame still painted beneath it.
            style={{
              opacity: layer.ready ? 1 : 0,
              pointerEvents: layer.ready ? 'auto' : 'none',
            }}
            className="absolute inset-0 h-full w-full border-0 bg-white transition-opacity duration-50 ease-out"
          />
        ))}
      </div>
      <NodeContextMenu
        target={elementMenu}
        entityLabel="element"
        onClose={() => setElementMenu(null)}
        onDone={(action, target) => {
          if (action === 'delete') {
            // The element disappears only after a reload; the inspection
            // moves to the enclosing collection - the deleted node has no
            // data to inspect anymore.
            setReloadCount((count) => count + 1)
            if (target.parentAddress)
              onSelectNodeRef.current(target.parentAddress)
            onNodeEditedRef.current?.(
              target.parentAddress ? [target.parentAddress] : [],
            )
          } else {
            // Hide/unhide: the dimming attribute is server-rendered, so the
            // element re-renders out-of-band (with full-reload fallback).
            // The node stays inspected, with a fresh snapshot.
            void updateElementOutOfBand(target.address)
            onNodeEditedRef.current?.(target.address)
            onSelectNodeRef.current(target.address)
          }
        }}
      />
      {linkEdit && (
        <LinkEditorDialog
          open
          onOpenChange={(open) => {
            if (open) return
            postToGuest({ type: 'neos-studio/link-cancel' })
            setLinkEdit(null)
          }}
          value={
            linkEdit.attributes !== null
              ? linkValueFromAttributes(linkEdit.attributes)
              : null
          }
          // Inline links carry the shared options as <a> attributes.
          withOptions
          onApply={(value) => {
            postToGuest({
              type: 'neos-studio/link-apply',
              attributes: linkAttributesFrom(value),
            })
            setLinkEdit(null)
          }}
          onRemove={
            linkEdit.attributes !== null
              ? () => {
                  postToGuest({
                    type: 'neos-studio/link-apply',
                    attributes: null,
                  })
                  setLinkEdit(null)
                }
              : undefined
          }
        />
      )}
      {pendingCreation && (
        <CreateNodeFlow
          request={pendingCreation}
          nodeTypes={nodeTypes}
          onCreated={(address) => {
            const parentAddress = addressFromContextPath(
              pendingCreation.parentContextPath,
            )
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
            if (error) toast.error(error, { title: 'Creating failed' })
          }}
        />
      )}
    </div>
  )
}
