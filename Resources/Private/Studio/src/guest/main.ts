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
 * content outliner follows) and plain contentEditable inline editing
 * (committed to the host on blur, Escape reverts). Selection pushed by the
 * host (outliner clicks) is outlined and scrolled into view.
 */
import type {
  GuestToHostMessage,
  HostToGuestMessage,
} from '../features/preview/protocol'

const WRAPPER_ATTRIBUTE = 'data-__neos-node-contextpath'
const COLLECTION_ATTRIBUTE = 'data-__neos-studio-collection'
const ALLOWED_TYPES_ATTRIBUTE = 'data-__neos-studio-allowed-types'
const PROPERTY_ATTRIBUTE = 'data-__neos-property'
const EDITABLE_NODE_ATTRIBUTE = 'data-__neos-editable-node-contextpath'
const PLACEHOLDER_ATTRIBUTE = 'data-__neos-studio-placeholder'

const HOVER_CLASS = 'neos-studio-hover'
const SELECTED_CLASS = 'neos-studio-selected'
const DROPPABLE_CLASS = 'neos-studio-droppable'
const DROP_TARGET_CLASS = 'neos-studio-drop-target'
const EMPTY_CLASS = 'neos-studio-empty'
const INDICATOR_ID = 'neos-studio-drop-indicator'

function post(message: GuestToHostMessage): void {
  window.parent.postMessage(message, window.location.origin)
}

/** Wrapped content elements by aggregate id, for host-pushed selection. */
const elementsByAggregateId = new Map<string, HTMLElement>()

let selectedElement: HTMLElement | null = null
let hoveredElement: HTMLElement | null = null

/** The inline edit in progress; initialHtml enables Escape-revert and the dirty check. */
let editSession: { element: HTMLElement; initialHtml: string } | null = null

function injectStyles(): void {
  const style = document.createElement('style')
  style.textContent = `
    [${WRAPPER_ATTRIBUTE}].${HOVER_CLASS}:not(.${SELECTED_CLASS}) {
      outline: 2px dashed rgba(0, 173, 238, 1.0);
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
    [${PROPERTY_ATTRIBUTE}] {
      cursor: text;
      outline: none !important;
    }
    [${PROPERTY_ATTRIBUTE}]:focus {
      outline: none !important;
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
  if (element === null) return
  element.classList.add(SELECTED_CLASS)
  if (options.reveal)
    element.scrollIntoView({ block: 'center', behavior: 'smooth' })
  if (options.notifyHost) {
    const contextPath = element.getAttribute(WRAPPER_ATTRIBUTE)
    if (contextPath) post({ type: 'neos-studio/node-selected', contextPath })
  }
}

function makeEditable(): void {
  for (const element of document.querySelectorAll<HTMLElement>(
    `[${PROPERTY_ATTRIBUTE}]`,
  )) {
    element.contentEditable = 'true'
    updateEmptyState(element)
  }
}

/**
 * Toggles the placeholder: a property is "empty" when it has no text and no
 * visual content (a lone <br> or empty <p> from a previous edit still counts
 * as empty, which CSS :empty would miss).
 */
function updateEmptyState(element: HTMLElement): void {
  if (!element.hasAttribute(PLACEHOLDER_ATTRIBUTE)) return
  const empty =
    (element.textContent ?? '').trim() === '' &&
    element.querySelector('img,picture,video,audio,iframe,svg,object,embed,hr,table') === null
  element.classList.toggle(EMPTY_CLASS, empty)
}

function commitEdit(): void {
  if (editSession === null) return
  const { element, initialHtml } = editSession
  editSession = null
  const value = element.innerHTML
  if (value === initialHtml) return
  const property = element.getAttribute(PROPERTY_ATTRIBUTE)
  // The editable wrapping carries the node identity itself; property markup
  // rendered without it falls back to the enclosing content element wrapper.
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
  const wrapper = target?.closest
    ? target.closest<HTMLElement>(`[${WRAPPER_ATTRIBUTE}]`)
    : null
  if (wrapper === hoveredElement) return
  hoveredElement?.classList.remove(HOVER_CLASS)
  hoveredElement = wrapper
  hoveredElement?.classList.add(HOVER_CLASS)
}

function onFocusIn(event: FocusEvent): void {
  const target = event.target as HTMLElement | null
  if (target?.getAttribute?.(PROPERTY_ATTRIBUTE) && target.isContentEditable) {
    editSession = { element: target, initialHtml: target.innerHTML }
  }
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && editSession !== null) {
    const { element, initialHtml } = editSession
    element.innerHTML = initialHtml
    element.blur() // focusout commits, but the content equals initialHtml again
    updateEmptyState(element) // programmatic reset fires no input event
    event.preventDefault()
  }
}

function onInput(event: Event): void {
  const target = event.target as HTMLElement | null
  const property = target?.closest
    ? target.closest<HTMLElement>(`[${PLACEHOLDER_ATTRIBUTE}]`)
    : null
  if (property) updateEmptyState(property)
}

/**
 * Node creation by drag and drop: the host announces the dragged node type
 * (creation-drag-start), collections whose server-computed allowed-types
 * list includes it become drop targets, dragover positions an insertion
 * indicator between the hovered collection's children, and drop reports the
 * insertion point back to the host, which runs the creation.
 */
let creationDragType: string | null = null

/** The insertion point under the pointer; before === null appends. */
let currentDrop: { collection: HTMLElement; before: HTMLElement | null } | null =
  null

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

function startCreationDrag(nodeTypeName: string): void {
  creationDragType = nodeTypeName
  for (const collection of document.querySelectorAll<HTMLElement>(
    `[${COLLECTION_ATTRIBUTE}]`,
  )) {
    if (collectionAllows(collection, nodeTypeName))
      collection.classList.add(DROPPABLE_CLASS)
  }
}

function endCreationDrag(): void {
  creationDragType = null
  setDropTarget(null)
  for (const collection of document.querySelectorAll<HTMLElement>(
    `.${DROPPABLE_CLASS}`,
  )) {
    collection.classList.remove(DROPPABLE_CLASS)
  }
}

/**
 * The collection's own child content elements (not those of nested
 * collections) - the elements the new node can be inserted between.
 */
function childElementsOf(collection: HTMLElement): HTMLElement[] {
  return Array.from(
    collection.querySelectorAll<HTMLElement>(`[${WRAPPER_ATTRIBUTE}]`),
  ).filter(
    (element) =>
      element.parentElement?.closest(`[${COLLECTION_ATTRIBUTE}]`) ===
      collection,
  )
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
  if (creationDragType === null) return
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
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  setDropTarget({
    collection,
    before: findInsertBefore(collection, event.clientX, event.clientY),
  })
}

function onDrop(event: DragEvent): void {
  if (creationDragType === null || currentDrop === null) return
  event.preventDefault()
  const parentContextPath = currentDrop.collection.getAttribute(
    WRAPPER_ATTRIBUTE,
  )
  const succeedingSiblingContextPath =
    currentDrop.before?.getAttribute(WRAPPER_ATTRIBUTE) ?? null
  if (parentContextPath) {
    post({
      type: 'neos-studio/create-node-request',
      nodeTypeName: creationDragType,
      parentContextPath,
      succeedingSiblingContextPath,
    })
  }
  // The host also sends creation-drag-end (panel dragend), but clear
  // immediately so the indicator never outlives the drop.
  endCreationDrag()
}

function onDragLeaveDocument(event: DragEvent): void {
  // Leaving the iframe entirely: keep the droppable highlights (the drag is
  // still alive), but the insertion indicator has no valid position anymore.
  if (creationDragType !== null && event.relatedTarget === null)
    setDropTarget(null)
}

function onHostMessage(event: MessageEvent): void {
  if (event.origin !== window.location.origin || event.source !== window.parent)
    return
  const message = event.data as HostToGuestMessage
  if (message?.type === 'neos-studio/select-node') {
    const element =
      message.aggregateId === null
        ? null
        : (elementsByAggregateId.get(message.aggregateId) ?? null)
    select(element, { notifyHost: false, reveal: true })
  }
  if (message?.type === 'neos-studio/creation-drag-start')
    startCreationDrag(message.nodeTypeName)
  if (message?.type === 'neos-studio/creation-drag-end') endCreationDrag()
}

function init(): void {
  injectStyles()
  indexWrappedElements()
  makeEditable()
  document.addEventListener('click', onClick, true)
  document.addEventListener('mouseover', onMouseOver)
  document.addEventListener('focusin', onFocusIn)
  document.addEventListener('focusout', commitEdit)
  document.addEventListener('keydown', onKeyDown)
  document.addEventListener('input', onInput)
  document.addEventListener('dragover', onDragOver)
  document.addEventListener('drop', onDrop)
  document.addEventListener('dragleave', onDragLeaveDocument)
  window.addEventListener('message', onHostMessage)
  post({ type: 'neos-studio/guest-ready' })
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}
