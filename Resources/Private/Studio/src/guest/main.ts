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
 * A hovered or selected content element (instanceof Neos.Neos:Content, marked
 * by data-__neos-studio-content) gets a floating "..." handle inside its top
 * right corner: clicking it asks the host to open the element menu
 * (hide/delete, rendered by the host over the iframe), dragging it moves the
 * element - the same drop machinery the creation drag uses, so the
 * server-computed allowed-types lists are respected.
 */
import type {
  GuestToHostMessage,
  HostToGuestMessage,
  PresenceHighlight,
} from '../features/preview/protocol'
import { applyLinkEdit, cancelLinkEdit } from './linkEditing'
import {
  applyRemotePropertyContent,
  ejectFromProperty,
  mountRichTextEditors,
  remoteCaretRect,
  setPropertyLocked,
  unmountRichTextEditors,
  type RichTextHooks,
} from './richtext'
import { TOOLBAR_CLASS } from './toolbar'

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
const INLINE_ATTRIBUTE = 'data-__neos-studio-inline'
const IMAGE_PROPERTY_ATTRIBUTE = 'data-__neos-studio-image-property'
const SHINE_THROUGH_ATTRIBUTE = 'data-__neos-studio-shine-through'

const HOVER_CLASS = 'neos-studio-hover'
const SELECTED_CLASS = 'neos-studio-selected'
const DROPPABLE_CLASS = 'neos-studio-droppable'
const DROP_TARGET_CLASS = 'neos-studio-drop-target'
const EMPTY_CLASS = 'neos-studio-empty'
const INDICATOR_ID = 'neos-studio-drop-indicator'
const HANDLE_ID = 'neos-studio-element-handle'
const ADD_BUTTON_ID = 'neos-studio-element-add-button'
const COLLECTION_ADD_CLASS = 'neos-studio-collection-add'
const IMAGE_OVERLAY_ID = 'neos-studio-image-overlay'
const SHINE_BUTTON_ID = 'neos-studio-shine-variant-button'
const PRESENCE_CLASS = 'neos-studio-presence'
const PRESENCE_BADGE_CLASS = 'neos-studio-presence-badge'
const PRESENCE_BADGE_EDITING_CLASS = 'neos-studio-presence-badge--editing'
const PRESENCE_CARET_CLASS = 'neos-studio-presence-caret'
/** A collaborator holds the edit lock on this element: clicks are swallowed
 * and the cursor says "not yours right now". */
const LOCKED_CLASS = 'neos-studio-locked'

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
    /* An inline editable (Neos.Neos:Editable block = false) renders as a
       <span> inside a line of text; TipTap's editable is a div, which would
       break that line into a block of its own. It only ever holds inline
       content here (see withoutBlocks in formatting.ts), so it can stay
       inline itself. */
    [${PROPERTY_ATTRIBUTE}][${INLINE_ATTRIBUTE}] .tiptap {
      display: inline;
    }
    /* Empty inline-editable properties show their configured placeholder
       (translated server-side into the markup), so new nodes are visible
       and invite editing. */
    [${PLACEHOLDER_ATTRIBUTE}].${EMPTY_CLASS}::before {
      content: attr(${PLACEHOLDER_ATTRIBUTE});
      opacity: 0.4;
      pointer-events: none;
    }
    /* On a block editable the placeholder box is followed by TipTap's editable
       div, so in normal flow it would claim a line of its own above the
       editor's empty paragraph - reading as a stray empty paragraph. Floating
       it at zero height takes it out of flow, and the paragraph's first line
       box flows around it: placeholder and caret share one line. Inline
       editables need none of this, their ::before sits in the same line
       already. */
    [${PLACEHOLDER_ATTRIBUTE}]:not([${INLINE_ATTRIBUTE}]).${EMPTY_CLASS}::before {
      float: left;
      height: 0;
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
    /* The "..." handle of the hovered/selected content element: opens the
       element menu on click, moves the element on drag. */
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
    /* The "+" companion of the handle: opens the insertion dialog for the
       element (create before/inside/after). Same look, click-only. */
    #${ADD_BUTTON_ID} {
      position: fixed;
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
      cursor: pointer;
      user-select: none;
      -webkit-user-select: none;
    }
    /* The standing "add content" affordance inside empty collections - the
       only way into a collection with nothing to hover. */
    .${COLLECTION_ADD_CLASS} {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      margin: 6px auto;
      padding: 5px 12px;
      font: 500 13px/1.2 system-ui, -apple-system, sans-serif;
      color: rgb(0, 173, 238);
      background: transparent;
      border: 1px dashed rgba(0, 173, 238, 0.6);
      border-radius: 4px;
      cursor: pointer;
    }
    .${COLLECTION_ADD_CLASS}:hover {
      background: rgba(0, 173, 238, 0.1);
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
  // Rebuilt from scratch, FIRST occurrence per node wins: document order
  // lists ancestors before descendants, so on sites that stamp an element's
  // metadata twice (core wrapping at the element level plus a site-specific
  // wrapper around its inner content area, both carrying the same node) the
  // index resolves to the OUTERMOST wrapper - the whole element. Everything
  // keyed by node identity must agree on that unit: an out-of-band fragment
  // always starts at the element's outermost wrapper, so swapping it into an
  // inner slot would nest the element's own chrome inside itself, doubling
  // it on every edit.
  elementsByAggregateId.clear()
  for (const element of document.querySelectorAll<HTMLElement>(
    `[${WRAPPER_ATTRIBUTE}]`,
  )) {
    try {
      const address = JSON.parse(
        element.getAttribute(WRAPPER_ATTRIBUTE) ?? '',
      ) as { aggregateId?: string }
      if (
        typeof address.aggregateId === 'string' &&
        !elementsByAggregateId.has(address.aggregateId)
      )
        elementsByAggregateId.set(address.aggregateId, element)
    } catch {
      /* malformed attribute - skip the element */
    }
  }
}

/**
 * The outermost wrapper of the same node. Clicks and hovers land on the
 * innermost wrapper under the pointer, but node-identity features (selection,
 * the edit lock, the out-of-band swap unit, the host's outline) work on
 * whole elements - on double-stamped elements those differ.
 */
function outermostWrapper(element: HTMLElement): HTMLElement {
  try {
    const address = JSON.parse(
      element.getAttribute(WRAPPER_ATTRIBUTE) ?? '',
    ) as { aggregateId?: string }
    const indexed =
      typeof address.aggregateId === 'string'
        ? elementsByAggregateId.get(address.aggregateId)
        : undefined
    if (indexed?.isConnected && indexed.contains(element)) return indexed
  } catch {
    /* malformed attribute - keep the element as-is */
  }
  return element
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
 * The "..." handle: a single floating button pinned inside the top right
 * corner of the hovered - or, absent a hover, the selected - content element
 * (only Neos.Neos:Content elements - collections are structure,
 * hidden/deleted/moved through their content). Click asks the host to open
 * the element menu at the handle's position; dragging it starts a move of
 * the element.
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

const PLUS_SVG =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">' +
  '<path d="M12 5v14M5 12h14"/></svg>'

/**
 * The "+" button pinned next to the "..." handle: opens the insertion
 * dialog for the element (host-side; defaults to "after", the canvas way of
 * thinking - "give me another one below this").
 */
function elementAddButton(): HTMLElement {
  let button = document.getElementById(ADD_BUTTON_ID)
  if (!button) {
    button = document.createElement('div')
    button.id = ADD_BUTTON_ID
    button.setAttribute('role', 'button')
    button.setAttribute('aria-label', 'Create new element')
    button.title = 'Create new element'
    button.innerHTML = PLUS_SVG
    button.addEventListener('click', onAddClick)
    document.body.appendChild(button)
  }
  return button
}

function onAddClick(): void {
  const element = handleTarget
  const contextPath = element?.getAttribute(WRAPPER_ATTRIBUTE)
  if (!element || !contextPath) return
  // The dialog acts relative to the element - make it the selection first,
  // so outliner and inspector show the reference point.
  select(element, { notifyHost: true })
  post({
    type: 'neos-studio/insert-node-request',
    contextPath,
    parentContextPath: parentCollectionContextPath(element),
    defaultMode: 'after',
  })
}

/** The element the handle is currently attached to (hovered or selected). */
let handleTarget: HTMLElement | null = null

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
  const addButton = elementAddButton()
  const hovered =
    hoveredElement?.hasAttribute(CONTENT_ATTRIBUTE) === true
      ? hoveredElement
      : null
  const selected =
    selectedElement?.hasAttribute(CONTENT_ATTRIBUTE) === true
      ? selectedElement
      : null
  const target = hovered ?? selected
  handleTarget = target !== null && target.isConnected ? target : null
  if (handleTarget === null) {
    handle.style.display = 'none'
    addButton.style.display = 'none'
    return
  }
  // Inside the element's top right corner, so it reads as part of it and
  // scrolls away with it; the "+" sits directly left of the "..." handle.
  const rect = handleTarget.getBoundingClientRect()
  handle.style.display = 'flex'
  handle.style.left = `${rect.right - 24 - 4}px`
  handle.style.top = `${rect.top + 4}px`
  addButton.style.display = 'flex'
  addButton.style.left = `${rect.right - 24 - 4 - 24 - 4}px`
  addButton.style.top = `${rect.top + 4}px`
}

function onHandleClick(): void {
  const element = handleTarget
  const contextPath = element?.getAttribute(WRAPPER_ATTRIBUTE)
  if (!element || !contextPath) return
  // The menu acts on the element - make it the selection first, so the
  // outliner and inspector show what the menu is about to change.
  select(element, { notifyHost: true })
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
  const element = handleTarget
  const nodeTypeName = element?.getAttribute(NODE_TYPE_ATTRIBUTE)
  if (!element || !nodeTypeName) {
    event.preventDefault()
    return
  }
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    // Firefox refuses to start a drag without data.
    event.dataTransfer.setData('text/plain', nodeTypeName)
    // Clamp the ghost's grab point into the element's bounds.
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
 * The identity of an inline-editable property element, resolved the same way
 * the old contentEditable path did: the editable wrapping carries the node's
 * contextPath directly, otherwise it falls back to the enclosing content
 * element wrapper.
 */
function propertyIdentity(
  element: HTMLElement,
): { contextPath: string; property: string } | null {
  const property = element.getAttribute(PROPERTY_ATTRIBUTE)
  const contextPath =
    element
      .closest(`[${EDITABLE_NODE_ATTRIBUTE}]`)
      ?.getAttribute(EDITABLE_NODE_ATTRIBUTE) ??
    element.closest(`[${WRAPPER_ATTRIBUTE}]`)?.getAttribute(WRAPPER_ATTRIBUTE)
  return property && contextPath ? { contextPath, property } : null
}

/** Report an inline edit to the host for persistence (the rich-text engine
 * calls this debounced while typing and flushed on blur). */
function commitProperty(element: HTMLElement, value: string): void {
  const identity = propertyIdentity(element)
  if (identity) {
    post({ type: 'neos-studio/property-changed', ...identity, value })
  }
}

/** Stream the in-progress content to the host (live typing, throttled).
 * cursor is the typist's caret as a ProseMirror position in `value`. */
function liveUpdateProperty(
  element: HTMLElement,
  value: string,
  cursor: number,
): void {
  const identity = propertyIdentity(element)
  if (identity) {
    post({ type: 'neos-studio/live-edit', ...identity, value, cursor })
  }
}

/**
 * The inline text the user is typing in right now - what a lost lock
 * arbitration ejects from. Guest-internal: the lock CLAIM itself derives
 * from the shell's element selection, not from typing.
 */
let ownEditingElement: HTMLElement | null = null

function reportEditingState(element: HTMLElement, editing: boolean): void {
  ownEditingElement = editing ? element : null
}

/** The hooks every rich-text mount gets (initial page and re-mounts after
 * out-of-band element swaps alike). */
const richTextHooks: RichTextHooks = {
  commit: commitProperty,
  activity: () => scheduleHandleUpdate(),
  liveUpdate: liveUpdateProperty,
  editingState: reportEditingState,
}

/** The guest's own floating UI - clicks on it are not clicks on the page. */
function isStudioUi(target: HTMLElement): boolean {
  return (
    target.closest(
      `#${HANDLE_ID}, #${ADD_BUTTON_ID}, #${IMAGE_OVERLAY_ID}, #${SHINE_BUTTON_ID}, .${TOOLBAR_CLASS}, .${COLLECTION_ADD_CLASS}`,
    ) !== null
  )
}

function onClick(event: MouseEvent): void {
  const target = event.target as HTMLElement | null
  if (!target?.closest) return
  // A collaborator holds the edit lock here: the element is off-limits -
  // swallow the click entirely (no selection, no link, no caret attempt).
  if (target.closest(`.${LOCKED_CLASS}`)) {
    event.preventDefault()
    event.stopPropagation()
    return
  }
  const anchor = target.closest<HTMLAnchorElement>('a[href]')
  if (anchor && handleLinkClick(event, anchor)) return
  const wrapper = target.closest<HTMLElement>(`[${WRAPPER_ATTRIBUTE}]`)
  if (wrapper) {
    // Resolve double-stamped elements to their outermost wrapper, so the
    // selection outline matches the swap unit and the host-driven outline.
    select(outermostWrapper(wrapper), { notifyHost: true })
    return
  }
  // A click outside every content element (and outside the guest's own
  // floating controls, which act on their targets themselves): clear the
  // element selection and let the shell inspect the current document.
  if (isStudioUi(target)) return
  select(null, { notifyHost: false })
  post({ type: 'neos-studio/document-selected' })
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
  // Over the "..." handle or its "+" companion (they sit inside their
  // element): keep the hover state, so they do not vanish under the pointer.
  if (target?.closest?.(`#${HANDLE_ID}, #${ADD_BUTTON_ID}`)) return
  // Over the image overlay itself (it sits on top of the image): keep it shown.
  if (target?.closest?.(`#${IMAGE_OVERLAY_ID}`)) return
  // Over the "Create variant" button (it floats over its element): keep it.
  if (target?.closest?.(`#${SHINE_BUTTON_ID}`)) return

  // In-place image picker: a rendered image whose property is known gets the
  // hover overlay; anything else hides it. Locked elements offer nothing.
  const image = target?.closest ? target.closest<HTMLElement>('img') : null
  if (
    image &&
    !image.closest(`.${LOCKED_CLASS}`) &&
    resolveImageTarget(image)
  ) {
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

  const hoverTarget = target?.closest
    ? target.closest<HTMLElement>(`[${WRAPPER_ATTRIBUTE}]`)
    : null
  // Locked elements do not light up on hover - they are not a target.
  const wrapper = hoverTarget?.classList.contains(LOCKED_CLASS)
    ? null
    : hoverTarget
  if (wrapper === hoveredElement) return
  hoveredElement?.classList.remove(HOVER_CLASS)
  hoveredElement = wrapper
  hoveredElement?.classList.add(HOVER_CLASS)
  // The "..." handle follows the hovered content element (falling back to
  // the selected one).
  scheduleHandleUpdate()
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

/**
 * Mounts a standing "Add content" button into every collection under `root`
 * without any child content elements - the only entry point into an empty
 * collection (there is nothing to hover for the element "+" button). Clicking
 * opens the host's insertion dialog with the collection as the "inside"
 * target. After a creation the preview reloads; an out-of-band element swap
 * re-runs this scoped to the fresh subtree instead.
 */
function mountCollectionAddButtons(root: ParentNode = document): void {
  const selector = `[${WRAPPER_ATTRIBUTE}][${COLLECTION_ATTRIBUTE}]`
  // querySelectorAll never matches the root itself; a swapped element could
  // be (or sit inside) a collection of its own.
  const rootItself =
    root instanceof HTMLElement && root.matches(selector) ? [root] : []
  for (const collection of [
    ...rootItself,
    ...root.querySelectorAll<HTMLElement>(selector),
  ]) {
    const contextPath = collection.getAttribute(WRAPPER_ATTRIBUTE)
    if (!contextPath || childElementsOf(collection).length > 0) continue
    // Already carries its button (possible on re-runs after a swap).
    if (collection.querySelector(`:scope > .${COLLECTION_ADD_CLASS}`)) continue
    const button = document.createElement('button')
    button.type = 'button'
    button.className = COLLECTION_ADD_CLASS
    button.innerHTML = `${PLUS_SVG}<span>Add content</span>`
    button.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      select(collection, { notifyHost: true })
      post({
        type: 'neos-studio/insert-node-request',
        contextPath,
        parentContextPath: parentCollectionContextPath(collection),
        defaultMode: 'inside',
      })
    })
    collection.appendChild(button)
  }
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
/**
 * Collaborators' positions on this page, pushed by the host: each focused
 * element gets a dashed outline in the person's color plus a floating
 * initials badge pinned to its top left corner (the top right belongs to the
 * element handle). Badges are fixed-position and follow their element through
 * scrolling and layout changes, like the other floating affordances.
 */
let presenceHighlights: PresenceHighlight[] = []

/** A rendered presence badge: pinned to its element's top left corner - or,
 * for an editing badge with a known live caret, riding on that caret line. */
interface PresenceBadgeEntry {
  badge: HTMLElement
  element: HTMLElement
  /** Editing badges only: the caret line and whose live caret to follow. */
  caret?: { line: HTMLElement; aggregateId: string }
}

/** Live badges and the elements they are pinned to, in render order. */
let presenceBadges: PresenceBadgeEntry[] = []

/**
 * The last live-typing caret per node (property + ProseMirror position),
 * fed by the collaborators' stream ticks. Rendered for whoever holds the
 * edit claim on that node; entries whose claim vanished are pruned on the
 * next roster render.
 */
const liveCarets = new Map<string, { property: string; cursor: number }>()

function injectPresenceStyles(): void {
  const style = document.createElement('style')
  style.textContent = `
    [${WRAPPER_ATTRIBUTE}].${PRESENCE_CLASS}:not(.${SELECTED_CLASS}) {
      outline: 2px dashed var(--neos-studio-presence-color, rgba(${PURPLE}, 1));
      outline-offset: 5px;
    }
    .${PRESENCE_BADGE_CLASS} {
      position: fixed;
      z-index: 2147483644;
      width: 20px;
      height: 20px;
      border-radius: 9999px;
      color: #fff;
      font: 600 10px/20px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      text-align: center;
      pointer-events: none;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
    }
    /* The edit-lock badge: a pill ("✏ AB") on the locked text itself. */
    .${PRESENCE_BADGE_EDITING_CLASS} {
      width: auto;
      padding: 0 7px;
      white-space: nowrap;
    }
    /* A collaborator's live caret inside the text they are editing: a steady
       line in their color (steady, not blinking - the blinking caret is the
       reader's own); their badge rides on top of it while a position is
       known. */
    .${PRESENCE_CARET_CLASS} {
      position: fixed;
      z-index: 2147483644;
      width: 2px;
      border-radius: 1px;
      pointer-events: none;
    }
    /* A locked element is fully inert for anyone but its holder: the wrapper
       keeps receiving pointer events (so the not-allowed cursor shows and
       onClick can swallow the click), but everything inside it takes none -
       no caret placement, no editor focus (which would raise the rich-text
       toolbar), no links, no hover affordances. */
    [${WRAPPER_ATTRIBUTE}].${LOCKED_CLASS} {
      cursor: not-allowed !important;
    }
    [${WRAPPER_ATTRIBUTE}].${LOCKED_CLASS} * {
      cursor: not-allowed !important;
      pointer-events: none !important;
    }
  `
  document.head.appendChild(style)
}

/**
 * The inline-editable property element of a node, resolved via the wrapper
 * index. Nested content elements render their own properties inside the
 * outer wrapper's subtree, so a candidate only counts when this wrapper is
 * its nearest one.
 */
function findPropertyElement(
  aggregateId: string,
  property: string,
): HTMLElement | null {
  const wrapper = elementsByAggregateId.get(aggregateId)
  if (!wrapper || !wrapper.isConnected) return null
  for (const candidate of wrapper.querySelectorAll<HTMLElement>(
    `[${PROPERTY_ATTRIBUTE}="${CSS.escape(property)}"]`,
  )) {
    if (candidate.closest(`[${WRAPPER_ATTRIBUTE}]`) === wrapper)
      return candidate
  }
  // The wrapper may itself carry the editable (single-property elements).
  return wrapper.getAttribute(PROPERTY_ATTRIBUTE) === property ? wrapper : null
}

/** Every inline-editable property element belonging to this node (not to a
 * nested content element) - the scope of an element-level edit lock. */
function propertyElementsOf(wrapper: HTMLElement): HTMLElement[] {
  const result: HTMLElement[] = []
  if (wrapper.hasAttribute(PROPERTY_ATTRIBUTE)) result.push(wrapper)
  for (const candidate of wrapper.querySelectorAll<HTMLElement>(
    `[${PROPERTY_ATTRIBUTE}]`,
  )) {
    if (candidate.closest(`[${WRAPPER_ATTRIBUTE}]`) === wrapper)
      result.push(candidate)
  }
  return result
}

/** Property elements currently locked by a collaborator, for unlock sweeps. */
let lockedPropertyElements = new Set<HTMLElement>()

/** Rebuild all presence decor from the current roster (also called after an
 * out-of-band element swap - the old badges point at replaced DOM). */
function renderPresence(): void {
  for (const { badge, caret } of presenceBadges) {
    badge.remove()
    caret?.line.remove()
  }
  presenceBadges = []
  // Live carets belong to edit claims - a caret whose claim vanished from
  // the roster (holder released, left, or lost the element) goes with it.
  const claimedAggregateIds = new Set(
    presenceHighlights.flatMap((user) =>
      user.editing !== null ? [user.editing.aggregateId] : [],
    ),
  )
  for (const aggregateId of liveCarets.keys()) {
    if (!claimedAggregateIds.has(aggregateId)) liveCarets.delete(aggregateId)
  }
  for (const element of document.querySelectorAll<HTMLElement>(
    `.${PRESENCE_CLASS}`,
  )) {
    element.classList.remove(PRESENCE_CLASS)
    element.style.removeProperty('--neos-studio-presence-color')
  }
  for (const element of document.querySelectorAll<HTMLElement>(
    `.${LOCKED_CLASS}`,
  )) {
    element.classList.remove(LOCKED_CLASS)
  }
  // Badge slots per element, so several people on one element stack side by
  // side instead of on top of each other.
  const slots = new Map<HTMLElement, number>()
  const addBadge = (
    element: HTMLElement,
    user: PresenceHighlight,
    editing: boolean,
  ): PresenceBadgeEntry => {
    const badge = document.createElement('div')
    badge.className = PRESENCE_BADGE_CLASS
    badge.textContent = editing ? `✏ ${user.initials}` : user.initials
    badge.title = editing ? `${user.name} is editing` : user.name
    badge.style.backgroundColor = user.color
    if (editing) badge.classList.add(PRESENCE_BADGE_EDITING_CLASS)
    document.body.appendChild(badge)
    const slot = slots.get(element) ?? 0
    slots.set(element, slot + 1)
    badge.dataset.slot = String(slot)
    const entry: PresenceBadgeEntry = { badge, element }
    presenceBadges.push(entry)
    return entry
  }
  // The edit locks: peers' actively edited texts become read-only here. The
  // sweep unlocks everything first, so a lock that vanished from the roster
  // (peer blurred, left, or timed out) releases without bookkeeping.
  for (const element of lockedPropertyElements) {
    if (element.isConnected) setPropertyLocked(element, false)
  }
  lockedPropertyElements = new Set()
  for (const user of presenceHighlights) {
    if (user.focusedAggregateId !== null) {
      const element = elementsByAggregateId.get(user.focusedAggregateId)
      if (element && element.isConnected) {
        element.classList.add(PRESENCE_CLASS)
        element.style.setProperty('--neos-studio-presence-color', user.color)
        addBadge(element, user, false)
      }
    }
    if (user.editing !== null) {
      const wrapper = elementsByAggregateId.get(user.editing.aggregateId)
      if (wrapper && wrapper.isConnected) {
        // The server arbitrates lock claims (first one wins) - a peer in
        // the roster IS the holder. If the own user is typing inside this
        // very element, they lost the race: discard the unpersisted
        // keystrokes and leave before the lock lands (persisting them
        // would clobber the winner's text).
        if (ownEditingElement && wrapper.contains(ownEditingElement)) {
          const ejected = ownEditingElement
          ownEditingElement = null
          ejectFromProperty(ejected)
          post({ type: 'neos-studio/editing-rejected', name: user.name })
        }
        // Element-level lock: every inline text of the claimed element
        // becomes read-only, not just the property being typed in - and the
        // element as a whole stops being a click target (see onClick).
        wrapper.classList.add(LOCKED_CLASS)
        for (const propertyElement of propertyElementsOf(wrapper)) {
          setPropertyLocked(propertyElement, true)
          lockedPropertyElements.add(propertyElement)
        }
        const badgeAnchor =
          (user.editing.property !== null
            ? findPropertyElement(
                user.editing.aggregateId,
                user.editing.property,
              )
            : null) ?? wrapper
        const entry = addBadge(badgeAnchor, user, true)
        // The holder's live caret (fed by their typing stream) renders as a
        // caret line in their color; the badge moves onto it whenever a
        // position is known (see positionPresenceBadges).
        const line = document.createElement('div')
        line.className = PRESENCE_CARET_CLASS
        line.style.backgroundColor = user.color
        line.style.display = 'none'
        document.body.appendChild(line)
        entry.caret = { line, aggregateId: user.editing.aggregateId }
      }
    }
  }
  positionPresenceBadges()
}

function positionPresenceBadges(): void {
  for (const { badge, element, caret } of presenceBadges) {
    // An editing badge rides on the holder's live caret when its position is
    // known and resolvable in this DOM - the badge becomes the caret's name
    // flag, like the collaborative editors people know.
    if (caret !== undefined) {
      const live = liveCarets.get(caret.aggregateId)
      const propertyElement =
        live === undefined
          ? null
          : findPropertyElement(caret.aggregateId, live.property)
      const rect =
        live !== undefined && propertyElement !== null
          ? remoteCaretRect(propertyElement, live.cursor)
          : null
      if (rect !== null) {
        caret.line.style.display = 'block'
        caret.line.style.left = `${rect.left - 1}px`
        caret.line.style.top = `${rect.top}px`
        caret.line.style.height = `${rect.bottom - rect.top}px`
        badge.style.display = 'block'
        badge.style.left = `${rect.left - 1}px`
        badge.style.top = `${rect.top - 24}px`
        continue
      }
      caret.line.style.display = 'none'
    }
    // Everything else (and editing badges without a caret yet) pins to the
    // element's top left corner.
    if (!element.isConnected) {
      badge.style.display = 'none'
      continue
    }
    const rect = element.getBoundingClientRect()
    const slot = Number(badge.dataset.slot ?? 0)
    badge.style.display = 'block'
    // Half outside the top left corner, like a nametag on the outline.
    badge.style.left = `${rect.left - 10 + slot * 24}px`
    badge.style.top = `${rect.top - 10}px`
  }
}

let presenceUpdateScheduled = false

function schedulePresenceUpdate(): void {
  if (presenceUpdateScheduled) return
  presenceUpdateScheduled = true
  requestAnimationFrame(() => {
    presenceUpdateScheduled = false
    positionPresenceBadges()
  })
}

function replaceElement(aggregateId: string, html: string): boolean {
  const element = elementsByAggregateId.get(aggregateId)
  if (!element || !element.isConnected) return false
  // Never swap DOM out from under the user's own typing: while a rich-text
  // editor inside the element has focus, a remote update would clobber the
  // draft and the caret. Report success anyway - the skipped refresh is the
  // deliberate phase-1 concurrency stopgap (last write wins on blur); a
  // failure return would trigger a full page reload, which is worse.
  // document.hasFocus() is load-bearing: activeElement keeps pointing at the
  // last-focused editable even after the user clicked into the shell (the
  // inspector, the asset picker). Without it, the swap after the user's OWN
  // edit - e.g. assigning an image while a caret was left in the element's
  // text - would be skipped silently and the preview would keep the stale
  // markup. Only a caret the user actually holds (the guest document has
  // focus) defers the swap.
  const active = document.activeElement
  if (
    document.hasFocus() &&
    active instanceof HTMLElement &&
    element.contains(active) &&
    (active.isContentEditable || active.closest('[contenteditable="true"]'))
  ) {
    return true
  }
  const template = document.createElement('template')
  template.innerHTML = html
  // The fragment can contain several metadata wrappers: nested child nodes,
  // and sites that stamp the edited element itself a second time around its
  // inner content area. Swap in the outermost wrapper OF THIS NODE (its
  // first occurrence in document order) - never blindly the fragment's first
  // wrapper, and never an inner same-node one.
  let replacement: HTMLElement | null = null
  for (const candidate of template.content.querySelectorAll<HTMLElement>(
    `[${WRAPPER_ATTRIBUTE}]`,
  )) {
    try {
      const address = JSON.parse(
        candidate.getAttribute(WRAPPER_ATTRIBUTE) ?? '',
      ) as { aggregateId?: string }
      if (address.aggregateId === aggregateId) {
        replacement = candidate
        break
      }
    } catch {
      /* malformed attribute - skip the candidate */
    }
  }
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

  // The old subtree's TipTap editors are gone with it - tear them down so
  // the registry does not accumulate disconnected editors across swaps.
  unmountRichTextEditors(element)
  element.replaceWith(replacement)
  // Re-run the full index: the swapped subtree's elements (including nested
  // ones) re-map to their fresh DOM nodes; ids that vanished with the old
  // markup simply keep a stale, disconnected entry - reads check isConnected.
  indexWrappedElements()
  mountRichTextEditors(replacement, richTextHooks)
  // Empty collections inside the fresh markup need their standing "Add
  // content" entry point again (scoped: elsewhere they already have one).
  mountCollectionAddButtons(replacement)
  if (wasSelected) {
    selectedElement = null
    select(replacement, { notifyHost: false })
  }
  scheduleHandleUpdate()
  // Presence badges/outlines inside the old subtree point at replaced DOM -
  // rebuild them against the fresh index.
  renderPresence()
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
  if (message?.type === 'neos-studio/presence-update') {
    presenceHighlights = message.users
    renderPresence()
  }
  if (message?.type === 'neos-studio/live-edit-apply') {
    // A collaborator's live typing: paint their current content into the
    // (locked) editor. Ephemeral - the change feed delivers the truth once
    // their edit persists.
    const element = findPropertyElement(message.aggregateId, message.property)
    if (element) {
      applyRemotePropertyContent(element, message.value)
      // Remember where their caret sits in the applied content - the
      // presence render draws it once (or while) the roster names them the
      // holder of this element.
      if (message.cursor !== null) {
        liveCarets.set(message.aggregateId, {
          property: message.property,
          cursor: message.cursor,
        })
      }
      schedulePresenceUpdate()
    }
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
  injectPresenceStyles()
  indexWrappedElements()
  mountCollectionAddButtons()
  // Rich-text inline editing: a TipTap editor on every editable property.
  // Commits post to the host debounced while typing and flushed on blur;
  // typing also streams live updates and holds the collaboration edit lock.
  mountRichTextEditors(document, richTextHooks)
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
  // ... and the collaborators' presence badges.
  window.addEventListener('scroll', schedulePresenceUpdate, true)
  window.addEventListener('resize', schedulePresenceUpdate)
  window.addEventListener('message', onHostMessage)
  post({ type: 'neos-studio/guest-ready' })
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}
