/**
 * The Studio guest script: injected by the PreviewController into every
 * edit-mode preview response (built standalone via vite.guest.config.ts, no
 * dependency on the SPA bundle). It works on the metadata markup Neos emits
 * in edit mode:
 *
 * - data-__neos-node-contextpath (ContentElementWrappingService) marks a
 *   content element and carries its NodeAddress as JSON
 * - data-__neos-property (ContentElementEditableService / Neos.Neos:Editable)
 *   marks the rendered value of an inline-editable property
 * - data-__neos-studio-collection (this package's ContentElementWrapping
 *   extension, see Root.fusion) marks content collections, which are styled
 *   as structural containers instead of content elements
 *
 * It handles click-to-select (blue outline, reported to the host so the
 * content outliner follows) and rich-text inline editing (a TipTap editor
 * mounted on each property, see richtext.ts; committed to the host on blur,
 * Escape reverts). Selection pushed by the host (outliner clicks) is outlined
 * and scrolled into view.
 *
 * A selected content element (instanceof Neos.Neos:Content, marked by
 * data-__neos-studio-content) gets a floating "..." handle at its top right:
 * clicking it asks the host to open the element menu (hide/delete, rendered
 * by the host over the iframe), dragging it moves the element - the same
 * drop machinery the creation drag uses, so the server-computed allowed-types
 * lists are respected.
 */
import type {
  GuestToHostMessage,
  HostToGuestMessage,
} from '../features/preview/protocol'
import { applyLinkEdit, cancelLinkEdit } from './linkEditing'
import { mountRichTextEditors } from './richtext'

const WRAPPER_ATTRIBUTE = 'data-__neos-node-contextpath'
const FUSION_PATH_ATTRIBUTE = 'data-__neos-fusion-path'
const COLLECTION_ATTRIBUTE = 'data-__neos-studio-collection'
const CONTENT_ATTRIBUTE = 'data-__neos-studio-content'
const HIDDEN_ATTRIBUTE = 'data-__neos-studio-hidden'
const NODE_TYPE_ATTRIBUTE = 'data-__neos-studio-node-type'
const ALLOWED_TYPES_ATTRIBUTE = 'data-__neos-studio-allowed-types'
const PROPERTY_ATTRIBUTE = 'data-__neos-property'
const EDITABLE_NODE_ATTRIBUTE = 'data-__neos-editable-node-contextpath'
const PLACEHOLDER_ATTRIBUTE = 'data-__neos-studio-placeholder'
const IMAGE_PROPERTY_ATTRIBUTE = 'data-__neos-studio-image-property'
const SHINE_THROUGH_ATTRIBUTE = 'data-__neos-studio-shine-through'

const HOVER_CLASS = 'neos-studio-hover'
const SELECTED_CLASS = 'neos-studio-selected'
const DROPPABLE_CLASS = 'neos-studio-droppable'
const DROP_TARGET_CLASS = 'neos-studio-drop-target'
const EMPTY_CLASS = 'neos-studio-empty'
const INDICATOR_ID = 'neos-studio-drop-indicator'
const HANDLE_ID = 'neos-studio-element-handle'
const IMAGE_OVERLAY_ID = 'neos-studio-image-overlay'
const SHINE_BUTTON_ID = 'neos-studio-shine-variant-button'

/** The Neos brand purple (purple-500 of the shell palette), for the
 *  shine-through indicators - the guest styles are literal CSS, no Tailwind. */
const PURPLE = '113, 97, 192'

function post(message: GuestToHostMessage): void {
  window.parent.postMessage(message, window.location.origin)
}

/** Wrapped content elements by aggregate id, for host-pushed selection. */
const elementsByAggregateId = new Map<string, HTMLElement>()

let selectedElement: HTMLElement | null = null
let hoveredElement: HTMLElement | null = null
/** The image currently under the in-place image-picker overlay, if any. */
let hoveredImage: HTMLElement | null = null
/** The shine-through element currently offering its "Create variant" button. */
let hoveredShineElement: HTMLElement | null = null

function injectStyles(): void {
  const style = document.createElement('style')
  style.textContent = `
    [${WRAPPER_ATTRIBUTE}].${HOVER_CLASS}:not(.${SELECTED_CLASS}) {
      outline: 2px solid rgba(0, 173, 238, 0.3);
      outline-offset: 5px;
    }
    [${WRAPPER_ATTRIBUTE}].${SELECTED_CLASS} {
      outline: 2px solid rgba(0, 173, 238, 1.0);
      outline-offset: 5px;
    }
    /* Content collections are structural containers, not content: their
       bounds stay faintly visible at all times, hover and selection render
       dashed purple instead of the content-element blue, and a minimum
       height keeps empty collections visible and clickable. */
    [${WRAPPER_ATTRIBUTE}][${COLLECTION_ATTRIBUTE}] {
      outline: none !important;
    }
    [${WRAPPER_ATTRIBUTE}][${COLLECTION_ATTRIBUTE}].${HOVER_CLASS}:not(.${SELECTED_CLASS})  {
      background-color: rgba(0, 173, 238, 0.1);
      outline: none !important;
    }
    [${WRAPPER_ATTRIBUTE}].${SELECTED_CLASS} [${WRAPPER_ATTRIBUTE}][${COLLECTION_ATTRIBUTE}] {
      background-color: rgba(0, 173, 238, 0.1);
      outline: none !important;
    }
    [${WRAPPER_ATTRIBUTE}][${COLLECTION_ATTRIBUTE}].${SELECTED_CLASS} {
      background-color: rgba(0, 173, 238, 0.2);
      outline: none !important;
    }
    /* Explicitly hidden elements stay editable but read as invisible-to-
       visitors; the opacity dims their whole subtree. */
    [${WRAPPER_ATTRIBUTE}][${HIDDEN_ATTRIBUTE}] {
      opacity: 0.5;
    }
    /* Shine-through content elements (visible only via dimension fallback)
       read as "not really here yet": dimmed under a diagonal construction-
       site pattern in the Neos purple. Only content elements are marked -
       collections are structure, patterning them would wash the whole page
       in one block. Content nested inside a shine-through content element
       skips its own dimming and pattern - the outer one already covers the
       area, stacking would darken unevenly. */
    [${WRAPPER_ATTRIBUTE}][${SHINE_THROUGH_ATTRIBUTE}][${CONTENT_ATTRIBUTE}] {
      position: relative;
      opacity: 0.65;
    }
    [${WRAPPER_ATTRIBUTE}][${SHINE_THROUGH_ATTRIBUTE}][${CONTENT_ATTRIBUTE}]::after {
      content: '';
      position: absolute;
      inset: 0;
      z-index: 1;
      pointer-events: none;
      background: repeating-linear-gradient(
        45deg,
        rgba(${PURPLE}, 0.22) 0px,
        rgba(${PURPLE}, 0.22) 10px,
        transparent 10px,
        transparent 20px
      );
    }
    [${WRAPPER_ATTRIBUTE}][${SHINE_THROUGH_ATTRIBUTE}][${CONTENT_ATTRIBUTE}] [${WRAPPER_ATTRIBUTE}][${SHINE_THROUGH_ATTRIBUTE}][${CONTENT_ATTRIBUTE}] {
      opacity: 1;
    }
    [${WRAPPER_ATTRIBUTE}][${SHINE_THROUGH_ATTRIBUTE}][${CONTENT_ATTRIBUTE}] [${WRAPPER_ATTRIBUTE}][${SHINE_THROUGH_ATTRIBUTE}][${CONTENT_ATTRIBUTE}]::after {
      content: none;
    }
    /* Hidden elements keep their (stronger) dimming when they also shine. */
    [${WRAPPER_ATTRIBUTE}][${SHINE_THROUGH_ATTRIBUTE}][${CONTENT_ATTRIBUTE}][${HIDDEN_ATTRIBUTE}] {
      opacity: 0.5;
    }
    /* The "Create variant" button centered on the hovered shine-through
       element: explicitly materializes it in the viewed dimension. Same
       layer as the image overlay - below the richtext toolbars and the
       element handle. */
    #${SHINE_BUTTON_ID} {
      position: fixed;
      z-index: 2147483645;
      display: none;
      align-items: center;
      gap: 6px;
      transform: translate(-50%, -50%);
      padding: 6px 12px;
      font: 500 13px/1.2 system-ui, -apple-system, sans-serif;
      color: #fff;
      background: rgb(${PURPLE});
      border: none;
      border-radius: 4px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
      cursor: pointer;
    }
    [${PROPERTY_ATTRIBUTE}] {
      cursor: text;
    }
    [${PROPERTY_ATTRIBUTE}]:hover,
    [${PROPERTY_ATTRIBUTE}]:focus,
    [${PROPERTY_ATTRIBUTE}]:focus-within {
      outline: 1px dotted rgba(0, 173, 238, 1.0);
      outline-offset: 1px;
    }
    /* No inline editing on shine-through elements (richtext.ts skips
       mounting there) - drop the editing affordances too, so the markup
       does not promise what a click will not deliver. */
    [${WRAPPER_ATTRIBUTE}][${SHINE_THROUGH_ATTRIBUTE}] [${PROPERTY_ATTRIBUTE}] {
      cursor: default;
    }
    [${WRAPPER_ATTRIBUTE}][${SHINE_THROUGH_ATTRIBUTE}] [${PROPERTY_ATTRIBUTE}]:hover {
      outline: none;
    }
    /* TipTap mounts its own contenteditable (.tiptap) inside the property
       element; it must inherit the host typography, not add a focus ring or
       stray block margins that the plain host markup never had. */
    [${PROPERTY_ATTRIBUTE}] .tiptap {
      outline: none !important;
    }
    [${PROPERTY_ATTRIBUTE}] .tiptap:focus {
      outline: none !important;
    }
    [${PROPERTY_ATTRIBUTE}] .tiptap > :first-child {
      margin-top: 0;
    }
    [${PROPERTY_ATTRIBUTE}] .tiptap > :last-child {
      margin-bottom: 0;
    }
    /* Empty inline-editable properties show their configured placeholder
       (translated server-side into the markup), so new nodes are visible
       and invite editing. */
    [${PLACEHOLDER_ATTRIBUTE}].${EMPTY_CLASS}::before {
      content: attr(${PLACEHOLDER_ATTRIBUTE});
      opacity: 0.4;
      pointer-events: none;
    }
    /* While a node type is dragged from the creation panel, collections that
       allow it light up; a minimum height keeps empty collections targetable.
       Specificity beats the collection "outline: none" rules above. */
    [${WRAPPER_ATTRIBUTE}][${COLLECTION_ATTRIBUTE}].${DROPPABLE_CLASS} {
      outline: 2px dashed rgba(0, 173, 238, 0.5) !important;
      outline-offset: 3px;
      min-height: 1.5rem;
      background-color: rgba(0, 173, 238, 0.04);
    }
    [${WRAPPER_ATTRIBUTE}][${COLLECTION_ATTRIBUTE}].${DROP_TARGET_CLASS} {
      outline: 2px solid rgba(0, 173, 238, 0.9) !important;
      background-color: rgba(0, 173, 238, 0.12);
    }
    #${INDICATOR_ID} {
      position: fixed;
      z-index: 2147483647;
      background: rgb(0, 173, 238);
      border-radius: 2px;
      pointer-events: none;
      display: none;
    }
    /* The "..." handle of the selected content element: opens the element
       menu on click, moves the element on drag. */
    #${HANDLE_ID} {
      position: fixed;
      /* One below the max so the richtext toolbars (2147483647) sit above it. */
      z-index: 2147483646;
      display: none;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      background: rgb(0, 173, 238);
      color: #fff;
      border: none;
      border-radius: 4px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
      cursor: grab;
      user-select: none;
      -webkit-user-select: none;
    }
    #${HANDLE_ID}:active {
      cursor: grabbing;
    }
    /* In-place image picker: hovering a rendered image (whose content element
       or ImageTag declares its image property) washes it blue and offers a
       "Select image" button. Sits above the image but below the richtext
       toolbars and the element handle. */
    #${IMAGE_OVERLAY_ID} {
      position: fixed;
      z-index: 2147483645;
      display: none;
      align-items: center;
      justify-content: center;
      background: rgba(0, 173, 238, 0.35);
      outline: 2px solid rgba(0, 173, 238, 1);
      outline-offset: -2px;
    }
    #${IMAGE_OVERLAY_ID} button {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      font: 500 13px/1.2 system-ui, -apple-system, sans-serif;
      color: #fff;
      background: rgb(0, 173, 238);
      border: none;
      border-radius: 4px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
      cursor: pointer;
    }
  `
  document.head.appendChild(style)
}

function indexWrappedElements(): void {
  for (const element of document.querySelectorAll<HTMLElement>(
    `[${WRAPPER_ATTRIBUTE}]`,
  )) {
    try {
      const address = JSON.parse(
        element.getAttribute(WRAPPER_ATTRIBUTE) ?? '',
      ) as { aggregateId?: string }
      if (typeof address.aggregateId === 'string')
        elementsByAggregateId.set(address.aggregateId, element)
    } catch {
      /* malformed attribute - skip the element */
    }
  }
}

function select(
  element: HTMLElement | null,
  options: { notifyHost: boolean; reveal?: boolean },
): void {
  if (selectedElement === element) return
  selectedElement?.classList.remove(SELECTED_CLASS)
  selectedElement = element
  scheduleHandleUpdate()
  if (element === null) return
  element.classList.add(SELECTED_CLASS)
  if (options.reveal)
    element.scrollIntoView({ block: 'center', behavior: 'smooth' })
  if (options.notifyHost) {
    const contextPath = element.getAttribute(WRAPPER_ATTRIBUTE)
    if (contextPath) post({ type: 'neos-studio/node-selected', contextPath })
  }
}

/**
 * The "..." handle: a single floating button pinned to the top right of the
 * selected content element (only Neos.Neos:Content elements - collections
 * are structure, hidden/deleted/moved through their content). Click asks the
 * host to open the element menu at the handle's position; dragging it starts
 * a move of the element.
 */
function elementHandle(): HTMLElement {
  let handle = document.getElementById(HANDLE_ID)
  if (!handle) {
    handle = document.createElement('div')
    handle.id = HANDLE_ID
    handle.setAttribute('role', 'button')
    handle.setAttribute('aria-label', 'Element options')
    handle.draggable = true
    handle.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
      '<circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>'
    handle.addEventListener('click', onHandleClick)
    handle.addEventListener('dragstart', onHandleDragStart)
    handle.addEventListener('dragend', () => endDrag())
    document.body.appendChild(handle)
  }
  return handle
}

let handleUpdateScheduled = false

/** Reposition on the next frame - scroll and input events fire in bursts. */
function scheduleHandleUpdate(): void {
  if (handleUpdateScheduled) return
  handleUpdateScheduled = true
  requestAnimationFrame(() => {
    handleUpdateScheduled = false
    positionHandle()
  })
}

function positionHandle(): void {
  const handle = elementHandle()
  const target =
    selectedElement?.hasAttribute(CONTENT_ATTRIBUTE) === true
      ? selectedElement
      : null
  if (target === null || !target.isConnected) {
    handle.style.display = 'none'
    return
  }
  const rect = target.getBoundingClientRect()
  // Right-aligned with the selection outline (2px at offset 5), floating just
  // above it; falls inside the element when that would leave the viewport.
  let top = rect.top - 34
  if (top < 2) top = rect.top + 9
  handle.style.display = 'flex'
  handle.style.left = `${rect.right + 7 - 24}px`
  handle.style.top = `${top}px`
}

function onHandleClick(): void {
  const element = selectedElement
  const contextPath = element?.getAttribute(WRAPPER_ATTRIBUTE)
  if (!element || !contextPath) return
  const rect = elementHandle().getBoundingClientRect()
  post({
    type: 'neos-studio/element-menu-request',
    contextPath,
    parentContextPath: parentCollectionContextPath(element),
    hidden: element.hasAttribute(HIDDEN_ATTRIBUTE),
    buttonRect: {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    },
  })
}

function onHandleDragStart(event: DragEvent): void {
  const element = selectedElement
  const nodeTypeName = element?.getAttribute(NODE_TYPE_ATTRIBUTE)
  if (!element || !nodeTypeName) {
    event.preventDefault()
    return
  }
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    // Firefox refuses to start a drag without data.
    event.dataTransfer.setData('text/plain', nodeTypeName)
    // The handle floats slightly outside the element - clamp the ghost's
    // grab point into its bounds.
    const rect = element.getBoundingClientRect()
    event.dataTransfer.setDragImage(
      element,
      Math.min(Math.max(event.clientX - rect.left, 0), rect.width),
      Math.min(Math.max(event.clientY - rect.top, 0), rect.height),
    )
  }
  startDrag(nodeTypeName, element)
}

/**
 * The picker target for a rendered image: which property of which node it is.
 * The property name comes from the nearest element carrying it - the <img>
 * itself when rendered via Neos.Neos:ImageTag, otherwise the enclosing content
 * element (a node with a single image property, see Root.fusion). The node
 * identity is always the enclosing content element wrapper. Images inside an
 * inline-editable rich text are content, not an image property - skipped.
 */
function resolveImageTarget(
  img: HTMLElement,
): { property: string; contextPath: string } | null {
  if (img.closest(`[${PROPERTY_ATTRIBUTE}]`)) return null
  // Shine-through elements offer "Create variant" instead - the node should
  // be materialized in the viewed dimension before editing pieces of it.
  if (img.closest(`[${WRAPPER_ATTRIBUTE}][${SHINE_THROUGH_ATTRIBUTE}]`))
    return null
  const property = img
    .closest<HTMLElement>(`[${IMAGE_PROPERTY_ATTRIBUTE}]`)
    ?.getAttribute(IMAGE_PROPERTY_ATTRIBUTE)
  const contextPath = img
    .closest<HTMLElement>(`[${WRAPPER_ATTRIBUTE}]`)
    ?.getAttribute(WRAPPER_ATTRIBUTE)
  if (!property || !contextPath) return null
  return { property, contextPath }
}

function imageOverlay(): HTMLElement {
  let overlay = document.getElementById(IMAGE_OVERLAY_ID)
  if (!overlay) {
    overlay = document.createElement('div')
    overlay.id = IMAGE_OVERLAY_ID
    const button = document.createElement('button')
    button.type = 'button'
    button.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/>' +
      '<path d="m21 15-3.6-3.6a2 2 0 0 0-2.8 0L6 20"/></svg>Select image'
    overlay.appendChild(button)
    // Only the button opens the picker. A click on the washed-blue background
    // still selects the node behind it (so it shows in the inspector) - the
    // overlay covers the image, so the click would otherwise be swallowed. The
    // button's onImageSelect stops propagation, so this never runs for it.
    button.addEventListener('click', onImageSelect)
    overlay.addEventListener('click', onImageOverlayClick)
    // Leaving the overlay (which sits on top of the image) hides it; re-entering
    // another image re-shows it via the document mouseover handler.
    overlay.addEventListener('mouseleave', hideImageOverlay)
    document.body.appendChild(overlay)
  }
  return overlay
}

function showImageOverlay(img: HTMLElement): void {
  hoveredImage = img
  const overlay = imageOverlay()
  const rect = img.getBoundingClientRect()
  overlay.style.display = 'flex'
  overlay.style.left = `${rect.left}px`
  overlay.style.top = `${rect.top}px`
  overlay.style.width = `${rect.width}px`
  overlay.style.height = `${rect.height}px`
}

function hideImageOverlay(): void {
  hoveredImage = null
  const overlay = document.getElementById(IMAGE_OVERLAY_ID)
  if (overlay) overlay.style.display = 'none'
}

/** Reposition (or drop) the overlay after scroll/resize, throttled to a frame. */
let imageOverlayUpdateScheduled = false
function scheduleImageOverlayUpdate(): void {
  if (imageOverlayUpdateScheduled || hoveredImage === null) return
  imageOverlayUpdateScheduled = true
  requestAnimationFrame(() => {
    imageOverlayUpdateScheduled = false
    if (hoveredImage === null) return
    if (hoveredImage.isConnected) showImageOverlay(hoveredImage)
    else hideImageOverlay()
  })
}

/** Background click over an image: select its content element, as if the image
 *  itself had been clicked (the overlay intercepts the native click). */
function onImageOverlayClick(): void {
  if (hoveredImage === null) return
  const wrapper = hoveredImage.closest<HTMLElement>(`[${WRAPPER_ATTRIBUTE}]`)
  if (wrapper) select(wrapper, { notifyHost: true })
}

function onImageSelect(event: MouseEvent): void {
  // Take precedence over node-select / link handling and never submit a form.
  event.preventDefault()
  event.stopPropagation()
  if (hoveredImage === null) return
  const target = resolveImageTarget(hoveredImage)
  if (target) post({ type: 'neos-studio/image-select-request', ...target })
}

/**
 * The "Create variant" button of shine-through content elements: hovering an
 * element that exists here only via dimension fallback centers the button on
 * it; clicking asks the host to explicitly materialize the node in the viewed
 * dimension - the same CreateNodeVariant an edit would trigger implicitly.
 * It takes the place of the in-place editing affordances (e.g. the image
 * overlay), which stay hidden on shine-through elements.
 */
function shineVariantButton(): HTMLElement {
  let button = document.getElementById(SHINE_BUTTON_ID)
  if (!button) {
    button = document.createElement('button')
    ;(button as HTMLButtonElement).type = 'button'
    button.id = SHINE_BUTTON_ID
    button.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 12 12 17 22 12"/></svg>Create variant'
    button.addEventListener('click', onShineVariantClick)
    document.body.appendChild(button)
  }
  return button
}

function showShineVariantButton(element: HTMLElement): void {
  hoveredShineElement = element
  const button = shineVariantButton()
  const rect = element.getBoundingClientRect()
  button.style.display = 'inline-flex'
  button.style.left = `${rect.left + rect.width / 2}px`
  button.style.top = `${rect.top + rect.height / 2}px`
}

function hideShineVariantButton(): void {
  hoveredShineElement = null
  const button = document.getElementById(SHINE_BUTTON_ID)
  if (button) button.style.display = 'none'
}

/** Reposition (or drop) the button after scroll/resize, throttled to a frame. */
let shineButtonUpdateScheduled = false
function scheduleShineButtonUpdate(): void {
  if (shineButtonUpdateScheduled || hoveredShineElement === null) return
  shineButtonUpdateScheduled = true
  requestAnimationFrame(() => {
    shineButtonUpdateScheduled = false
    if (hoveredShineElement === null) return
    if (hoveredShineElement.isConnected)
      showShineVariantButton(hoveredShineElement)
    else hideShineVariantButton()
  })
}

function onShineVariantClick(event: MouseEvent): void {
  // Take precedence over node-select / link handling and never submit a form.
  event.preventDefault()
  event.stopPropagation()
  const contextPath = hoveredShineElement?.getAttribute(WRAPPER_ATTRIBUTE)
  if (contextPath)
    post({ type: 'neos-studio/create-variant-request', contextPath })
}

/** NodeAddress JSON of the collection containing the element, if any. */
function parentCollectionContextPath(element: HTMLElement): string | null {
  return (
    element.parentElement
      ?.closest(`[${COLLECTION_ATTRIBUTE}]`)
      ?.getAttribute(WRAPPER_ATTRIBUTE) ?? null
  )
}

/**
 * Report a committed inline edit to the host (the rich-text engine calls this
 * on blur with the property's serialized HTML). Resolves the node identity the
 * same way the old contentEditable path did: the editable wrapping carries it
 * directly, otherwise it falls back to the enclosing content element wrapper.
 */
function commitProperty(element: HTMLElement, value: string): void {
  const property = element.getAttribute(PROPERTY_ATTRIBUTE)
  const contextPath =
    element
      .closest(`[${EDITABLE_NODE_ATTRIBUTE}]`)
      ?.getAttribute(EDITABLE_NODE_ATTRIBUTE) ??
    element.closest(`[${WRAPPER_ATTRIBUTE}]`)?.getAttribute(WRAPPER_ATTRIBUTE)
  if (property && contextPath) {
    post({ type: 'neos-studio/property-changed', contextPath, property, value })
  }
}

function onClick(event: MouseEvent): void {
  const target = event.target as HTMLElement | null
  if (!target?.closest) return
  const anchor = target.closest<HTMLAnchorElement>('a[href]')
  if (anchor && handleLinkClick(event, anchor)) return
  const wrapper = target.closest<HTMLElement>(`[${WRAPPER_ATTRIBUTE}]`)
  if (wrapper) select(wrapper, { notifyHost: true })
}

/**
 * Links keep working in the edit-mode preview, but the iframe itself never
 * navigates - the document to show is the host's decision. Returns true when
 * the click is handled entirely (a navigation); false when it should still
 * select the containing content element.
 */
function handleLinkClick(
  event: MouseEvent,
  anchor: HTMLAnchorElement,
): boolean {
  const href = anchor.getAttribute('href') ?? ''
  // Same-page anchors keep their default scroll behavior.
  if (href.startsWith('#')) return false
  // A link inside an inline-editable text is content being edited, not
  // navigation - just place the caret.
  if (anchor.closest(`[${PROPERTY_ATTRIBUTE}]`)) {
    event.preventDefault()
    return false
  }
  event.preventDefault()
  let url: URL
  try {
    url = new URL(href, window.location.href)
  } catch {
    return true
  }
  // Document links in non-live workspaces point to the core preview action
  // and carry the target's NodeAddress (NodeUriBuilder::previewUriFor) - let
  // the host navigate, so the document tree follows and the preview reloads
  // through the Studio's own edit-mode endpoint.
  if (
    url.origin === window.location.origin &&
    url.pathname.endsWith('/neos/preview')
  ) {
    const contextPath = url.searchParams.get('node')
    if (contextPath) {
      post({ type: 'neos-studio/navigate-to-node', contextPath })
      return true
    }
  }
  // Everything else (external sites, assets, mailto): open alongside, the
  // editor never loses the editing context.
  window.open(url.href, '_blank', 'noopener')
  return true
}

function onMouseOver(event: MouseEvent): void {
  const target = event.target as HTMLElement | null
  // Over the image overlay itself (it sits on top of the image): keep it shown.
  if (target?.closest?.(`#${IMAGE_OVERLAY_ID}`)) return
  // Over the "Create variant" button (it floats over its element): keep it.
  if (target?.closest?.(`#${SHINE_BUTTON_ID}`)) return

  // In-place image picker: a rendered image whose property is known gets the
  // hover overlay; anything else hides it.
  const image = target?.closest ? target.closest<HTMLElement>('img') : null
  if (image && resolveImageTarget(image)) {
    if (image !== hoveredImage) showImageOverlay(image)
  } else {
    hideImageOverlay()
  }

  // Shine-through content elements offer explicit variant creation while
  // hovered - matching the striped elements, not the collections around them.
  const shine = target?.closest
    ? target.closest<HTMLElement>(
        `[${WRAPPER_ATTRIBUTE}][${SHINE_THROUGH_ATTRIBUTE}][${CONTENT_ATTRIBUTE}]`,
      )
    : null
  if (shine) {
    if (shine !== hoveredShineElement) showShineVariantButton(shine)
  } else {
    hideShineVariantButton()
  }

  const wrapper = target?.closest
    ? target.closest<HTMLElement>(`[${WRAPPER_ATTRIBUTE}]`)
    : null
  if (wrapper === hoveredElement) return
  hoveredElement?.classList.remove(HOVER_CLASS)
  hoveredElement = wrapper
  hoveredElement?.classList.add(HOVER_CLASS)
}

/**
 * Drag and drop into content collections, serving two drags with the same
 * drop machinery: node creation (the host announces the dragged node type
 * via creation-drag-start) and moving an existing element (started locally
 * from its "..." handle). Collections whose server-computed allowed-types
 * list includes the dragged type become drop targets, dragover positions an
 * insertion indicator between the hovered collection's children, and drop
 * reports the insertion point to the host, which runs the command.
 */
let activeDrag: {
  nodeTypeName: string
  /** The element being moved; null for a creation drag. */
  movingElement: HTMLElement | null
} | null = null

/** The insertion point under the pointer; before === null appends. */
let currentDrop: {
  collection: HTMLElement
  before: HTMLElement | null
} | null = null

function collectionAllows(
  collection: HTMLElement,
  nodeTypeName: string,
): boolean {
  try {
    const allowed = JSON.parse(
      collection.getAttribute(ALLOWED_TYPES_ATTRIBUTE) ?? '[]',
    ) as unknown
    return Array.isArray(allowed) && allowed.includes(nodeTypeName)
  } catch {
    return false
  }
}

function startDrag(
  nodeTypeName: string,
  movingElement: HTMLElement | null = null,
): void {
  activeDrag = { nodeTypeName, movingElement }
  for (const collection of document.querySelectorAll<HTMLElement>(
    `[${COLLECTION_ATTRIBUTE}]`,
  )) {
    // An element cannot be moved into its own subtree.
    if (movingElement?.contains(collection)) continue
    if (collectionAllows(collection, nodeTypeName))
      collection.classList.add(DROPPABLE_CLASS)
  }
}

function endDrag(): void {
  activeDrag = null
  setDropTarget(null)
  for (const collection of document.querySelectorAll<HTMLElement>(
    `.${DROPPABLE_CLASS}`,
  )) {
    collection.classList.remove(DROPPABLE_CLASS)
  }
}

/**
 * The collection's own child content elements (not those of nested
 * collections) - the elements the dragged node can be inserted between. A
 * moved element is not its own sibling, so it never counts.
 */
function childElementsOf(collection: HTMLElement): HTMLElement[] {
  return Array.from(
    collection.querySelectorAll<HTMLElement>(`[${WRAPPER_ATTRIBUTE}]`),
  ).filter(
    (element) =>
      element !== activeDrag?.movingElement &&
      element.parentElement?.closest(`[${COLLECTION_ATTRIBUTE}]`) ===
        collection,
  )
}

/** Whether dropping the element at this insertion point changes nothing. */
function isNoOpMove(
  element: HTMLElement,
  collection: HTMLElement,
  before: HTMLElement | null,
): boolean {
  if (
    element.parentElement?.closest(`[${COLLECTION_ATTRIBUTE}]`) !== collection
  )
    return false
  const next =
    childElementsOf(collection).find(
      (sibling) =>
        element.compareDocumentPosition(sibling) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ) ?? null
  return before === next
}

/** The child to insert before, from the pointer position; null appends. */
function findInsertBefore(
  collection: HTMLElement,
  x: number,
  y: number,
): HTMLElement | null {
  const children = childElementsOf(collection)
  if (children.length === 0) return null
  const rects = children.map((child) => child.getBoundingClientRect())
  // Row layouts (columns) need the X axis; pick the axis the children
  // actually spread along.
  const spreadX =
    Math.max(...rects.map((r) => r.left + r.width / 2)) -
    Math.min(...rects.map((r) => r.left + r.width / 2))
  const spreadY =
    Math.max(...rects.map((r) => r.top + r.height / 2)) -
    Math.min(...rects.map((r) => r.top + r.height / 2))
  const horizontal = spreadX > spreadY
  for (let i = 0; i < rects.length; i++) {
    const midpoint = horizontal
      ? rects[i].left + rects[i].width / 2
      : rects[i].top + rects[i].height / 2
    if ((horizontal ? x : y) < midpoint) return children[i]
  }
  return null
}

function dropIndicator(): HTMLElement {
  let indicator = document.getElementById(INDICATOR_ID)
  if (!indicator) {
    indicator = document.createElement('div')
    indicator.id = INDICATOR_ID
    document.body.appendChild(indicator)
  }
  return indicator
}

function setDropTarget(
  drop: { collection: HTMLElement; before: HTMLElement | null } | null,
): void {
  if (currentDrop?.collection !== drop?.collection) {
    currentDrop?.collection.classList.remove(DROP_TARGET_CLASS)
    drop?.collection.classList.add(DROP_TARGET_CLASS)
  }
  currentDrop = drop
  const indicator = dropIndicator()
  if (drop === null) {
    indicator.style.display = 'none'
    return
  }

  // The indicator line sits at the insertion point: before the "before"
  // element, after the last child, or across an empty collection. Its
  // orientation follows the children's layout axis.
  const children = childElementsOf(drop.collection)
  const collectionRect = drop.collection.getBoundingClientRect()
  let horizontal = false
  let edge: number
  if (children.length === 0) {
    edge = collectionRect.top + 4
  } else {
    const rects = children.map((child) => child.getBoundingClientRect())
    const spreadX =
      Math.max(...rects.map((r) => r.left + r.width / 2)) -
      Math.min(...rects.map((r) => r.left + r.width / 2))
    const spreadY =
      Math.max(...rects.map((r) => r.top + r.height / 2)) -
      Math.min(...rects.map((r) => r.top + r.height / 2))
    horizontal = spreadX > spreadY
    const beforeRect = drop.before?.getBoundingClientRect()
    const lastRect = rects[rects.length - 1]
    edge = horizontal
      ? (beforeRect ? beforeRect.left : lastRect.right) - 1
      : (beforeRect ? beforeRect.top : lastRect.bottom) - 1
  }
  indicator.style.display = 'block'
  if (horizontal) {
    indicator.style.left = `${edge}px`
    indicator.style.top = `${collectionRect.top}px`
    indicator.style.width = '3px'
    indicator.style.height = `${collectionRect.height}px`
  } else {
    indicator.style.left = `${collectionRect.left}px`
    indicator.style.top = `${edge}px`
    indicator.style.width = `${collectionRect.width}px`
    indicator.style.height = '3px'
  }
}

function onDragOver(event: DragEvent): void {
  if (activeDrag === null) return
  const target = event.target as HTMLElement | null
  const collection = target?.closest
    ? target.closest<HTMLElement>(`.${DROPPABLE_CLASS}`)
    : null
  if (!collection) {
    setDropTarget(null)
    return
  }
  // preventDefault marks the spot as a valid drop location.
  event.preventDefault()
  if (event.dataTransfer)
    event.dataTransfer.dropEffect = activeDrag.movingElement ? 'move' : 'copy'
  setDropTarget({
    collection,
    before: findInsertBefore(collection, event.clientX, event.clientY),
  })
}

function onDrop(event: DragEvent): void {
  if (activeDrag === null || currentDrop === null) return
  event.preventDefault()
  const drag = activeDrag
  const { collection, before } = currentDrop
  const parentContextPath = collection.getAttribute(WRAPPER_ATTRIBUTE)
  const succeedingSiblingContextPath =
    before?.getAttribute(WRAPPER_ATTRIBUTE) ?? null
  let message: GuestToHostMessage | null = null
  if (parentContextPath && drag.movingElement === null) {
    message = {
      type: 'neos-studio/create-node-request',
      nodeTypeName: drag.nodeTypeName,
      parentContextPath,
      succeedingSiblingContextPath,
    }
  } else if (parentContextPath && drag.movingElement !== null) {
    const nodeContextPath = drag.movingElement.getAttribute(WRAPPER_ATTRIBUTE)
    if (
      nodeContextPath &&
      !isNoOpMove(drag.movingElement, collection, before)
    ) {
      message = {
        type: 'neos-studio/move-node-request',
        nodeContextPath,
        sourceParentContextPath: parentCollectionContextPath(
          drag.movingElement,
        ),
        parentContextPath,
        succeedingSiblingContextPath,
      }
    }
  }
  // The host also sends creation-drag-end (panel dragend), but clear
  // immediately so the indicator never outlives the drop.
  endDrag()
  if (message) post(message)
}

function onDragLeaveDocument(event: DragEvent): void {
  // Leaving the iframe entirely: keep the droppable highlights (the drag is
  // still alive), but the insertion indicator has no valid position anymore.
  if (activeDrag !== null && event.relatedTarget === null) setDropTarget(null)
}

/**
 * Swap a node's rendered element for freshly rendered markup (an out-of-band
 * re-render after an edit). The document-level event delegation keeps working
 * on the new DOM by itself; what needs re-running for the subtree is the
 * aggregate-id index, the rich-text editor mounts, and the selection decor
 * when the swapped element (or something inside it) was selected. Returns
 * false when the swap cannot happen - the host falls back to a full reload.
 */
function replaceElement(aggregateId: string, html: string): boolean {
  const element = elementsByAggregateId.get(aggregateId)
  if (!element || !element.isConnected) return false
  const template = document.createElement('template')
  template.innerHTML = html
  const replacement = template.content.querySelector<HTMLElement>(
    `[${WRAPPER_ATTRIBUTE}]`,
  )
  if (!replacement) return false

  const wasSelected =
    selectedElement !== null &&
    (selectedElement === element || element.contains(selectedElement))
  if (
    hoveredElement !== null &&
    (hoveredElement === element || element.contains(hoveredElement))
  ) {
    hoveredElement.classList.remove(HOVER_CLASS)
    hoveredElement = null
  }
  // Floating overlays anchored inside the old subtree have nothing to point
  // at anymore; hovering the new markup brings them back.
  hideImageOverlay()
  hideShineVariantButton()

  element.replaceWith(replacement)
  // Re-run the full index: the swapped subtree's elements (including nested
  // ones) re-map to their fresh DOM nodes; ids that vanished with the old
  // markup simply keep a stale, disconnected entry - reads check isConnected.
  indexWrappedElements()
  mountRichTextEditors(replacement, {
    commit: commitProperty,
    activity: scheduleHandleUpdate,
  })
  if (wasSelected) {
    selectedElement = null
    select(replacement, { notifyHost: false })
  }
  scheduleHandleUpdate()
  return true
}

function onHostMessage(event: MessageEvent): void {
  if (event.origin !== window.location.origin || event.source !== window.parent)
    return
  const message = event.data as HostToGuestMessage
  if (message?.type === 'neos-studio/select-node') {
    const indexed =
      message.aggregateId === null
        ? null
        : (elementsByAggregateId.get(message.aggregateId) ?? null)
    // An element replaced out-of-band can leave stale index entries behind.
    const element = indexed?.isConnected ? indexed : null
    select(element, { notifyHost: false, reveal: true })
  }
  if (message?.type === 'neos-studio/element-info-request') {
    const element = elementsByAggregateId.get(message.aggregateId)
    post({
      type: 'neos-studio/element-info',
      requestId: message.requestId,
      fusionPath: element?.isConnected
        ? (element.getAttribute(FUSION_PATH_ATTRIBUTE) ?? null)
        : null,
    })
  }
  if (message?.type === 'neos-studio/replace-element') {
    post({
      type: 'neos-studio/element-replaced',
      requestId: message.requestId,
      ok: replaceElement(message.aggregateId, message.html),
    })
  }
  if (message?.type === 'neos-studio/creation-drag-start')
    startDrag(message.nodeTypeName)
  if (message?.type === 'neos-studio/creation-drag-end') endDrag()
  // The Link Editor dialog's answer for a pending rich-text link edit.
  if (message?.type === 'neos-studio/link-apply')
    applyLinkEdit(message.attributes)
  if (message?.type === 'neos-studio/link-cancel') cancelLinkEdit()
}

function init(): void {
  injectStyles()
  indexWrappedElements()
  // Rich-text inline editing: mount a TipTap editor on every editable
  // property. Commit-on-blur posts the change to the host; typing and focus
  // keep the floating element handle attached as the layout shifts.
  mountRichTextEditors(document, {
    commit: commitProperty,
    activity: scheduleHandleUpdate,
  })
  document.addEventListener('click', onClick, true)
  document.addEventListener('mouseover', onMouseOver)
  document.addEventListener('dragover', onDragOver)
  document.addEventListener('drop', onDrop)
  document.addEventListener('dragleave', onDragLeaveDocument)
  // The element handle floats at fixed coordinates - follow the selected
  // element through scrolling (capture catches nested scroll containers)
  // and layout changes from resizes or inline edits.
  window.addEventListener('scroll', scheduleHandleUpdate, true)
  window.addEventListener('resize', scheduleHandleUpdate)
  // The image-picker overlay floats at fixed coordinates too - follow its
  // image through scrolling and layout changes.
  window.addEventListener('scroll', scheduleImageOverlayUpdate, true)
  window.addEventListener('resize', scheduleImageOverlayUpdate)
  // ... as does the shine-through "Create variant" button.
  window.addEventListener('scroll', scheduleShineButtonUpdate, true)
  window.addEventListener('resize', scheduleShineButtonUpdate)
  window.addEventListener('message', onHostMessage)
  post({ type: 'neos-studio/guest-ready' })
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}
