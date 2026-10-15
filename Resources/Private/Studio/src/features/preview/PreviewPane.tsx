import { useEffect, useEffectEvent, useState } from 'react'
import { queryString } from '@/api/http/request'
import { renderNodeElement } from '@/api/neos/endpoints/nodes'
import { useNodeTypes } from '@/api/neos/endpoints/nodeTypes'
import {
  isRemoved,
  nodeAddressFromContextPath,
  nodeAddressKey,
  sameNodeAddress,
  type Node,
  type NodeAddress,
} from '@/api/neos/schema'
import { toast } from '@/components/ui/toast'
import { config } from '@/config'
import { useLatestRef } from '@/hooks/use-latest-ref'
import { translate as t } from '@/lib/i18n'
import {
  peekPendingFlash,
  subscribeFlashRequest,
  takePendingFlash,
} from '@/app/flash'
import { useNodeEditable } from '@/features/access/useAccess'
import type { CreateNodeRequest } from '@/features/creation/createNode'
import {
  type CreationDrag,
  getCreationDrag,
  subscribeCreationDrag,
} from '@/features/creation/creationDrag'
import {
  InsertNodeDialog,
  type InsertRequest,
} from '@/features/creation/InsertNodeDialog'
import { CreateNodeFlow } from '@/features/creation/NodeCreationDialog'
import { moveNodesByAddress } from '@/features/editing/nodeActions'
import {
  NodeContextMenu,
  type NodeMenuTarget,
} from '@/features/editing/NodeContextMenu'
import {
  createVariant,
  persistPropertyChange,
  persistPropertyChangeQueued,
} from '@/features/editing/persistProperty'
import {
  publishLocalLiveEdit,
  subscribeRemoteLiveEdits,
} from '@/features/collaboration/liveEdits'
import { useAssetPicker } from '@/features/media/AssetPicker'
import { assetReference, localAssetIdFor } from '@/api/neos/endpoints/assets'
import { LinkEditorDialog } from '@/features/links/LinkEditorDialog'
import { useKeyboardShortcut } from '@/features/shortcuts/useKeyboardShortcut'
import {
  linkAttributesFrom,
  linkValueFromAttributes,
} from '@/features/links/linkValue'
import type {
  GuestToHostMessage,
  LinkAttributes,
  PresenceHighlight,
} from './protocol'
import { useGuestBridge } from './useGuestBridge'
import { usePreviewLayers } from './usePreviewLayers'

/**
 * URL of the Studio's own preview endpoint for a node. Its complete identity -
 * content repository, workspace, dimension space point and aggregate id -
 * travels as query parameters, named as in Neos.Api, so the combination to
 * preview is explicit in the URL. The "inPlace" rendering mode requests the
 * content-element metadata markup the guest script needs for click-to-select
 * and inline editing.
 */
export function previewUrl(
  address: NodeAddress,
  mode?: string,
  /** Render a DELETED page - it is invisible to the preview otherwise. */
  includeDeleted = false,
): string {
  return `${config.previewBase}${queryString({
    contentRepositoryId: address.contentRepositoryId,
    workspaceName: address.workspaceName,
    dimensionSpacePoint: address.dimensionSpacePoint,
    nodeAggregateId: address.nodeAggregateId,
    mode,
    includeDeleted: includeDeleted ? '1' : undefined,
  })}`
}

/**
 * The preview's reload keyboard shortcut, mounted in the topbar. Renders
 * nothing - the reload is keystroke-only (mod+shift+r).
 */
export function PreviewToolbar({
  document,
  onReload,
}: {
  document: Node | null
  onReload: () => void
}) {
  // Guarded instead of conditionally registered: without a document there is
  // nothing to reload and the keystroke stays untouched.
  useKeyboardShortcut({
    id: 'preview.reload',
    // Deliberately shadows the browser's hard reload: inside Studio,
    // reloading "the page" means reloading the preview.
    key: 'r',
    title: t('preview.reload', 'Reload preview'),
    category: t('shortcuts.category.preview', 'Preview'),
    handler: () => {
      if (!document) return false
      onReload()
    },
  })
  return null
}

/**
 * A request to refresh nodes' rendered elements in place (see
 * PreviewPane's elementUpdate). Bump `token` for every new batch.
 */
export type PreviewElementUpdate = {
  addresses: NodeAddress[]
  token: number
  /**
   * The batch reports collaborators' edits rather than the user's own. A
   * remote edit may well concern another page: an element not rendered on
   * this one is skipped instead of reloading the frame. (Own edits reach the
   * current page by definition, so there a missing element means the markup
   * cannot be patched and the page reloads.)
   */
  remote?: boolean
}

/** How one element fared in an out-of-band update. */
type ElementUpdateOutcome =
  /** Re-rendered and swapped into the live page. */
  | 'updated'
  /** Not rendered on this page (or no guest to ask) - nothing to patch. */
  | 'absent'
  /** It is on the page, but could not be patched in place. */
  | 'failed'

/** How long the host waits for the guest's element-info / element-replaced. */
const GUEST_REPLY_TIMEOUT_MS = 3000

/**
 * Renders the selected document in an iframe and bridges it to the shell:
 * clicks on content elements surface as onSelectNode (the outliner follows),
 * the shell's selection is pushed back as an outline, and inline edits are
 * persisted through the commands API. The iframe is same-origin and
 * authenticated by the backend session, not the OAuth token.
 *
 * The frames themselves are managed by usePreviewLayers (stacking,
 * crossfade, retirement), the postMessage plumbing by useGuestBridge; this
 * component holds what the guest's messages lead to - menus, dialogs and
 * persistence.
 */
export function PreviewPane({
  document,
  selectedAddress,
  onSelectNode,
  onNavigateToNode,
  onNodeEdited,
  reloadToken = 0,
  elementUpdate = null,
  presence = [],
}: {
  document: Node | null
  /** Address outlined in the preview - the node inspected in the shell. */
  selectedAddress: NodeAddress | null
  /** A content element was clicked in the preview. */
  onSelectNode: (address: NodeAddress) => void
  /** A link to another document was followed in the preview. */
  onNavigateToNode?: (address: NodeAddress) => void
  /** An edit for these addresses was persisted (structural edits touch several). */
  onNodeEdited?: (address: NodeAddress | NodeAddress[]) => void
  /** Bump to reload the iframe after edits made outside of it (e.g. the inspector). */
  reloadToken?: number
  /**
   * Bump the token to refresh just these nodes' rendered elements in place
   * (an inspector edit with ui.reloadIfChanged, or remote collaborators'
   * edits): each element is re-rendered out-of-band and swapped into the
   * live page - no iframe reload, scroll position and inline editing
   * elsewhere survive. Elements that cannot be updated in place fall back
   * to a single full reload per batch; with `remote` set, elements not on
   * this page are skipped (see PreviewElementUpdate).
   */
  elementUpdate?: PreviewElementUpdate | null
  /** Collaborators on this document, outlined at the elements they focus. */
  presence?: PresenceHighlight[]
}) {
  // Bumping this reloads the preview even when the src is unchanged (e.g.
  // after edits in the same document); it feeds into a layer's load key.
  const [reloadCount, setReloadCount] = useState(0)
  const reload = () => setReloadCount((count) => count + 1)
  // A drop from the creation panel landed in the preview - the creation flow
  // (optional creation dialog + command) runs for this insertion point.
  const [pendingCreation, setPendingCreation] =
    useState<CreateNodeRequest | null>(null)
  // The element menu (hide/unhide/delete) requested via the "..." handle in
  // the guest, anchored at the handle's viewport position over the iframe.
  const [elementMenu, setElementMenu] = useState<NodeMenuTarget | null>(null)
  // "Create new…" was picked in the element menu - the insertion dialog
  // (mode + node type selection) is open for that element.
  const [insertRequest, setInsertRequest] = useState<InsertRequest | null>(null)
  // A pending rich-text link edit from the guest: the Link Editor dialog is
  // open for it, and the guest waits for link-apply / link-cancel.
  const [linkEdit, setLinkEdit] = useState<{
    attributes: LinkAttributes | null
  } | null>(null)
  const { data: nodeTypes } = useNodeTypes()
  // Opening the Media Library picker for an image clicked in the preview.
  const { requestPick } = useAssetPicker()

  // Read by the message handler, which runs outside of render.
  const documentAddressRef = useLatestRef(document)
  const onNodeEditedRef = useLatestRef(onNodeEdited)

  // A deleted page (selected from the trash) renders in FRONTEND mode: the
  // page as it was, without the editing guest - there is nothing to edit in
  // place on a page that is deleted, and click-to-select would hand out
  // addresses of nodes that no read outside this preview resolves.
  const documentDeleted = document !== null && isRemoved(document)
  // A page outside the account's access roles renders the same way: without
  // the editing guest. Withholding "inPlace" is what actually disarms it -
  // the metadata markup the guest needs for inline editing, click-to-select
  // and creation drop targets is simply never emitted, so there is nothing to
  // disable afterwards and no way to click into an edit the server would
  // refuse. Locking the guest from the shell instead would leave that markup
  // in the page and the ban one message away from being missed.
  const documentEditable = useNodeEditable(document)
  const documentReadOnly = documentDeleted || !documentEditable
  const src = document
    ? previewUrl(
        document,
        documentReadOnly ? undefined : 'inPlace',
        documentDeleted,
      )
    : null
  const loadKey = src ? `${src}#${reloadCount}#${reloadToken}` : null

  // A new load means a new guest lifecycle; a menu anchored in the previous
  // document has nothing to point at anymore - nor has a pending link edit.
  // Reset during render (not in an effect), so no frame shows them stale.
  const [menusLoadKey, setMenusLoadKey] = useState(loadKey)
  if (menusLoadKey !== loadKey) {
    setMenusLoadKey(loadKey)
    setElementMenu(null)
    setLinkEdit(null)
  }

  const layers = usePreviewLayers({
    src,
    loadKey,
    guestless: documentReadOnly,
    // Declared below; only called once a layer retires.
    flushBeforeRetire: (frame) => bridge.flush(frame),
  })
  const { guestReady, activeFrameRef } = layers

  /** A guest message, with the frame's identity and shape verified. */
  const handleGuestMessage = (message: GuestToHostMessage) => {
    // A malformed NodeAddress JSON in the markup must not break anything:
    // every conversion goes through here, and a message whose addresses do
    // not parse is dropped.
    const addressOf = (nodeAddress: string): NodeAddress | null => {
      try {
        return nodeAddressFromContextPath(nodeAddress)
      } catch {
        return null
      }
    }
    switch (message.type) {
      case 'neos-studio/node-selected': {
        const address = addressOf(message.nodeAddress)
        if (address) onSelectNode(address)
        break
      }
      case 'neos-studio/document-selected':
        // A click outside every content element inspects the document
        // itself - matching a click on the document in the tree.
        if (documentAddressRef.current) onSelectNode(documentAddressRef.current)
        break
      case 'neos-studio/navigate-to-node': {
        const address = addressOf(message.nodeAddress)
        if (address) onNavigateToNode?.(address)
        break
      }
      case 'neos-studio/property-changed': {
        const address = addressOf(message.nodeAddress)
        if (!address) break
        // Queued: typing commits arrive every 1.5-5s and must never
        // overlap in flight - newer values coalesce behind the running
        // save, latest wins.
        persistPropertyChangeQueued(address, message.property, message.value)
          .then(() => onNodeEditedRef.current?.(address))
          .catch((e: unknown) =>
            toast.error(e, {
              title: t('editing.saveFailed', 'Saving failed'),
            }),
          )
        break
      }
      case 'neos-studio/editing-rejected':
        // Lost the lock arbitration: the guest already reverted and left
        // the editor; tell the user what happened to their keystrokes.
        toast.info(
          t(
            'collaboration.editingRejected',
            '{name} is already editing this element - your changes were not saved.',
            { name: message.name },
          ),
        )
        break
      case 'neos-studio/live-edit': {
        // The own live-typing stream: hand to the collaboration channel;
        // the realtime transport (if any) fans it out to peers.
        const address = addressOf(message.nodeAddress)
        if (!address) break
        publishLocalLiveEdit({
          nodeAggregateId: address.nodeAggregateId,
          property: message.property,
          value: message.value,
          cursor: message.cursor,
        })
        break
      }
      case 'neos-studio/create-node-request': {
        const parentAddress = addressOf(message.parentNodeAddress)
        const succeedingSiblingAddress =
          message.succeedingSiblingNodeAddress === null
            ? null
            : addressOf(message.succeedingSiblingNodeAddress)
        if (
          !parentAddress ||
          (message.succeedingSiblingNodeAddress !== null &&
            !succeedingSiblingAddress)
        )
          break
        setPendingCreation({
          nodeTypeName: message.nodeTypeName,
          parentAddress,
          succeedingSiblingAddress,
        })
        break
      }
      case 'neos-studio/insert-node-request': {
        // A "+" affordance in the preview: the element's companion button
        // (insert after) or an empty collection's add button (inside).
        const referenceAddress = addressOf(message.nodeAddress)
        if (!referenceAddress) break
        setInsertRequest({
          referenceAddress,
          parentAddress: message.parentNodeAddress
            ? addressOf(message.parentNodeAddress)
            : null,
          defaultMode: message.defaultMode,
        })
        break
      }
      case 'neos-studio/element-menu-request': {
        const frameRect = activeFrameRef.current?.getBoundingClientRect()
        const address = addressOf(message.nodeAddress)
        if (!frameRect || !address) break
        const parentAddress = message.parentNodeAddress
          ? addressOf(message.parentNodeAddress)
          : null
        // A second click on the same handle closes the menu (toggle).
        setElementMenu((previous) =>
          sameNodeAddress(previous?.address, address)
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
        break
      }
      case 'neos-studio/link-edit-request':
        setLinkEdit({ attributes: message.attributes })
        break
      case 'neos-studio/create-variant-request': {
        // The "Create variant" button over a shine-through element: run the
        // CreateNodeVariant an edit would trigger implicitly, then reload -
        // the element renders without the fallback pattern afterwards.
        const address = addressOf(message.nodeAddress)
        if (!address) break
        createVariant(address)
          .then(() => {
            toast.success(
              t(
                'editing.variantCreated',
                'Variant created in the current dimension.',
              ),
            )
            reload()
            onNodeEditedRef.current?.(address)
            onSelectNode(address)
          })
          .catch((e: unknown) =>
            toast.error(e, {
              title: t(
                'editing.createVariantFailed',
                'Creating the variant failed',
              ),
            }),
          )
        break
      }
      case 'neos-studio/image-select-request': {
        const address = addressOf(message.nodeAddress)
        if (!address) break
        const property = message.property
        // Hand off to the Media Library picker; on pick, resolve the chosen
        // asset to a local identifier, set the image property, and reload the
        // preview so the new image renders.
        requestPick({
          title: property,
          onPick: (asset) => {
            localAssetIdFor(asset)
              .then((id) =>
                persistPropertyChange(address, property, assetReference(id)),
              )
              .then(() => {
                reload()
                onNodeEditedRef.current?.(address)
                // Inspect the edited node so the reloaded preview scrolls it
                // into view (the shell pushes the selection to the fresh
                // guest, which reveals it) - as an inspector edit does.
                onSelectNode(address)
              })
              .catch((e: unknown) =>
                toast.error(e, {
                  title: t('editing.setImageFailed', 'Setting image failed'),
                }),
              )
          },
        })
        break
      }
      case 'neos-studio/move-node-request': {
        const nodeAddress = addressOf(message.nodeAddress)
        const targetAddress = addressOf(message.parentNodeAddress)
        const sourceAddress = message.sourceParentNodeAddress
          ? addressOf(message.sourceParentNodeAddress)
          : null
        const succeedingSiblingAddress =
          message.succeedingSiblingNodeAddress === null
            ? null
            : addressOf(message.succeedingSiblingNodeAddress)
        if (
          !nodeAddress ||
          !targetAddress ||
          (message.succeedingSiblingNodeAddress !== null &&
            !succeedingSiblingAddress)
        )
          break
        moveNodesByAddress([
          {
            nodeAddress,
            newParentAddress: targetAddress,
            succeedingSiblingAddress,
          },
        ])
          .then(() => {
            // The moved element renders in its new place after a reload;
            // both affected collections refresh in the outliner. The
            // selection stays on the moved node.
            reload()
            const parents =
              sourceAddress && !sameNodeAddress(sourceAddress, targetAddress)
                ? [targetAddress, sourceAddress]
                : [targetAddress]
            onNodeEditedRef.current?.(parents)
          })
          .catch((e: unknown) =>
            toast.error(e, {
              title: t('editing.moveFailed', 'Moving failed'),
            }),
          )
        break
      }
    }
  }

  const bridge = useGuestBridge({ layers, onMessage: handleGuestMessage })
  const { postToGuest } = bridge

  // Announce node-type drags from the creation panel to the guest, which
  // marks the collections allowing that type as drop targets. A drag can
  // already be underway when the guest (re)boots - push the current state.
  useEffect(() => {
    if (!guestReady) return
    const send = (drag: CreationDrag) =>
      postToGuest(
        drag
          ? {
              type: 'neos-studio/creation-drag-start',
              nodeTypeName: drag.nodeTypeName,
            }
          : { type: 'neos-studio/creation-drag-end' },
      )
    const current = getCreationDrag()
    if (current) send(current)
    return subscribeCreationDrag(send)
  }, [guestReady, postToGuest])

  // The selection by value: callers may pass a new object for the same node.
  const selectedKey = selectedAddress ? nodeAddressKey(selectedAddress) : null

  // Push the shell's selection into the guest (also right after it boots) -
  // on a changed selection value, read in an effect event, not on every new
  // address object.
  const pushSelection = useEffectEvent(() => {
    const aggregateId = selectedAddress?.nodeAggregateId ?? null
    // Opening a page selects its document node, which sites wrap around the whole page body.
    // Revealing that element centers the body, so every page switch (and every reload) would land
    // somewhat below the top. The document is the page itself - there is nothing to reveal.
    const documentAddress = documentAddressRef.current
    const isDocument =
      aggregateId !== null &&
      documentAddress !== null &&
      documentAddress.nodeAggregateId === aggregateId
    postToGuest({
      type: 'neos-studio/select-node',
      aggregateId,
      reveal: !isDocument,
    })
  })
  useEffect(() => {
    if (guestReady) pushSelection()
  }, [guestReady, selectedKey])

  // A pending "pulse this element" request, held until the guest showing *that* element is ready.
  //
  // Waiting on guestReady alone is not enough, and quietly loses the pulse: the shell boots on the
  // previously selected document, whose guest reports ready first. Draining there would post into
  // the wrong page and consume the request before the linked document has even loaded. Matching the
  // selection makes the drain wait for the right guest - the request comes from a deep link, which
  // selects the node it names, so the two line up by the time it can be shown.
  const selectedAggregateId = selectedAddress?.nodeAggregateId ?? null
  useEffect(() => {
    if (!guestReady || selectedAggregateId === null) return
    const drain = () => {
      const pending = peekPendingFlash()
      if (pending === null) return
      if (pending !== selectedAggregateId) return
      if (!activeFrameRef.current?.contentWindow) return
      takePendingFlash()
      postToGuest({ type: 'neos-studio/flash-node', aggregateId: pending })
    }
    drain()
    return subscribeFlashRequest(drain)
  }, [guestReady, selectedAggregateId, activeFrameRef, postToGuest])

  // Out-of-band element update: re-render one node's element on the server
  // and swap it into the live page instead of reloading the iframe (the
  // ui.reloadIfChanged semantics; also hide/unhide of content elements).
  const updateElementOutOfBand = async (
    address: NodeAddress,
  ): Promise<ElementUpdateOutcome> => {
    // No guest to ask: whether the node is on this page is unknown.
    if (!guestReady) return 'failed'
    const aggregateId = address.nodeAggregateId
    const info = await bridge.request(
      (requestId) => ({
        type: 'neos-studio/element-info-request',
        requestId,
        aggregateId,
      }),
      'neos-studio/element-info',
      GUEST_REPLY_TIMEOUT_MS,
    )
    if (info === null) return 'failed'
    // Answered, but not rendered here (e.g. a document, or a node of
    // another page).
    if (info.fusionPath === null) return 'absent'
    let html: string
    try {
      html = await renderNodeElement(address, info.fusionPath)
    } catch {
      return 'failed'
    }
    const ack = await bridge.request(
      (requestId) => ({
        type: 'neos-studio/replace-element',
        requestId,
        aggregateId,
        html,
      }),
      'neos-studio/element-replaced',
      GUEST_REPLY_TIMEOUT_MS,
    )
    return ack?.ok ? 'updated' : 'failed'
  }

  /**
   * Update a batch of elements out-of-band, falling back to ONE full reload
   * when any of them could not be patched - correctness first, the
   * optimization is best-effort. An element missing from the page counts as
   * a failure for the user's own edits (the page should show it), but not
   * for remote ones: collaborators edit other pages too.
   */
  const updateElementsOutOfBand = async (
    addresses: NodeAddress[],
    remote = false,
  ): Promise<void> => {
    const outcomes = await Promise.all(addresses.map(updateElementOutOfBand))
    const needsReload = outcomes.some(
      (outcome) => outcome === 'failed' || (outcome === 'absent' && !remote),
    )
    if (needsReload) reload()
  }

  // Only a new update (token) triggers a pass - everything else is read fresh
  // when it runs (an effect event); a re-run on guestReady flips would replay
  // old edits.
  const runElementUpdate = useEffectEvent(() => {
    if (!elementUpdate) return
    void updateElementsOutOfBand(
      elementUpdate.addresses,
      elementUpdate.remote === true,
    )
  })
  const updateToken = elementUpdate?.token
  useEffect(() => {
    // The only state update in there, reload(), runs after the awaited guest
    // and server round trips - never synchronously within this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
    if (updateToken !== undefined) runElementUpdate()
  }, [updateToken])

  // Push the collaborators' positions into the guest (also right after it
  // boots, so a reloaded frame regains the presence decor and edit locks).
  useEffect(() => {
    if (!guestReady) return
    postToGuest({ type: 'neos-studio/presence-update', users: presence })
  }, [guestReady, presence, postToGuest])

  // Forward collaborators' live-typing ticks into the guest, which paints
  // them into the locked inline text. The guest ignores ticks for elements
  // not on this page.
  useEffect(() => {
    if (!guestReady) return
    return subscribeRemoteLiveEdits((edit) => {
      postToGuest({
        type: 'neos-studio/live-edit-apply',
        aggregateId: edit.nodeAggregateId,
        property: edit.property,
        value: edit.value,
        cursor: edit.cursor,
      })
    })
  }, [guestReady, postToGuest])

  // No document is a transient state only: one is selected automatically on
  // boot and after every site or dimension switch, so there is nothing to
  // tell the user - the pane simply stays empty for the moment.
  if (!document || !src) return null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative min-h-0 w-full flex-1">
        {layers.layers.map((layer) => (
          <iframe
            key={layer.id}
            ref={layers.frameRef(layer.id)}
            src={layer.src}
            title={t('preview.pageFrame', 'Page preview')}
            // Readiness without a guest handshake (see usePreviewLayers).
            onLoad={() => layers.onFrameLoad(layer)}
            // Until it is ready the incoming frame is invisible on top - keep
            // clicks flowing to the outgoing frame still painted beneath it.
            style={{
              opacity: layer.ready ? 1 : 0,
              pointerEvents: layer.ready ? 'auto' : 'none',
            }}
            className="absolute inset-0 h-full w-full border-0 bg-neutral-950 dark:bg-white transition-opacity duration-50 ease-out"
          />
        ))}
      </div>
      <NodeContextMenu
        target={elementMenu}
        entityLabel={t('editing.entity.element', 'element')}
        clipboardKind="content"
        onPasted={(affectedAddresses) => {
          // Structure changed - full reload (the pasted element isn't in the
          // current markup, so no out-of-band fragment can place it).
          reload()
          onNodeEditedRef.current?.(affectedAddresses)
        }}
        onClose={() => setElementMenu(null)}
        onCreateNew={(target) =>
          setInsertRequest({
            referenceAddress: target.address,
            parentAddress: target.parentAddress,
            defaultMode: 'after',
          })
        }
        onDone={(action, targets) => {
          // The preview's element menu is always single-target (the guest
          // selects one element at a time).
          const target = targets[0]
          if (target === undefined) return
          if (action === 'delete') {
            // The element disappears only after a reload; the inspection
            // moves to the enclosing collection - the deleted node has no
            // data to inspect anymore.
            reload()
            if (target.parentAddress) onSelectNode(target.parentAddress)
            onNodeEditedRef.current?.(
              target.parentAddress ? [target.parentAddress] : [],
            )
          } else {
            // Hide/unhide: the dimming attribute is server-rendered, so the
            // element re-renders out-of-band (with full-reload fallback).
            // The node stays inspected, with a fresh snapshot.
            void updateElementsOutOfBand([target.address])
            onNodeEditedRef.current?.(target.address)
            onSelectNode(target.address)
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
      <InsertNodeDialog
        request={insertRequest}
        role="content"
        onCreated={(address, creation) => {
          setInsertRequest(null)
          // Same follow-up as a drop from the creation panel: the new element
          // renders after a reload, the outliner refreshes below the parent,
          // and the new node is inspected (outlining it in the fresh page).
          reload()
          onNodeEditedRef.current?.(creation.parentAddress)
          onSelectNode(address)
        }}
        onClose={() => setInsertRequest(null)}
      />
      {pendingCreation && (
        <CreateNodeFlow
          request={pendingCreation}
          nodeTypes={nodeTypes}
          onCreated={(address) => {
            const parentAddress = pendingCreation.parentAddress
            setPendingCreation(null)
            // The new node only renders after a reload; the shell then
            // refreshes the outliner below the collection and inspects the
            // new node (which also outlines it in the reloaded preview).
            reload()
            onNodeEditedRef.current?.(parentAddress)
            onSelectNode(address)
          }}
          onCancel={(error) => {
            setPendingCreation(null)
            if (error)
              toast.error(error, {
                title: t('editing.createFailed', 'Creating failed'),
              })
          }}
        />
      )}
    </div>
  )
}
