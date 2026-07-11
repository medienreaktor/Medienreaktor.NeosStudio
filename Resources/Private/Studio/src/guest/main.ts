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
 *
 * It handles click-to-select (blue outline, reported to the host so the
 * content outliner follows) and plain contentEditable inline editing
 * (committed to the host on blur, Escape reverts). Selection pushed by the
 * host (outliner clicks) is outlined and scrolled into view.
 */
import type { GuestToHostMessage, HostToGuestMessage } from '../features/preview/protocol'

const WRAPPER_ATTRIBUTE = 'data-__neos-node-contextpath'
const PROPERTY_ATTRIBUTE = 'data-__neos-property'
const EDITABLE_NODE_ATTRIBUTE = 'data-__neos-editable-node-contextpath'

const HOVER_CLASS = 'neos-studio-hover'
const SELECTED_CLASS = 'neos-studio-selected'

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
      outline: 1px dashed rgba(0, 173, 238, 0.65) !important;
      outline-offset: -1px;
    }
    [${WRAPPER_ATTRIBUTE}].${SELECTED_CLASS} {
      outline: 2px solid #00adee !important;
      outline-offset: -2px;
    }
    [${PROPERTY_ATTRIBUTE}] {
      cursor: text;
    }
    [${PROPERTY_ATTRIBUTE}]:focus {
      outline: 1px dashed rgba(0, 173, 238, 0.65);
      outline-offset: 2px;
    }
  `
  document.head.appendChild(style)
}

function indexWrappedElements(): void {
  for (const element of document.querySelectorAll<HTMLElement>(`[${WRAPPER_ATTRIBUTE}]`)) {
    try {
      const address = JSON.parse(element.getAttribute(WRAPPER_ATTRIBUTE) ?? '') as { aggregateId?: string }
      if (typeof address.aggregateId === 'string') elementsByAggregateId.set(address.aggregateId, element)
    } catch {
      /* malformed attribute - skip the element */
    }
  }
}

function select(element: HTMLElement | null, options: { notifyHost: boolean; reveal?: boolean }): void {
  if (selectedElement === element) return
  selectedElement?.classList.remove(SELECTED_CLASS)
  selectedElement = element
  if (element === null) return
  element.classList.add(SELECTED_CLASS)
  if (options.reveal) element.scrollIntoView({ block: 'center', behavior: 'smooth' })
  if (options.notifyHost) {
    const contextPath = element.getAttribute(WRAPPER_ATTRIBUTE)
    if (contextPath) post({ type: 'neos-studio/node-selected', contextPath })
  }
}

function makeEditable(): void {
  for (const element of document.querySelectorAll<HTMLElement>(`[${PROPERTY_ATTRIBUTE}]`)) {
    element.contentEditable = 'true'
  }
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
    element.closest(`[${EDITABLE_NODE_ATTRIBUTE}]`)?.getAttribute(EDITABLE_NODE_ATTRIBUTE) ??
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
function handleLinkClick(event: MouseEvent, anchor: HTMLAnchorElement): boolean {
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
  if (url.origin === window.location.origin && url.pathname.endsWith('/neos/preview')) {
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
  const wrapper = target?.closest ? target.closest<HTMLElement>(`[${WRAPPER_ATTRIBUTE}]`) : null
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
    event.preventDefault()
  }
}

function onHostMessage(event: MessageEvent): void {
  if (event.origin !== window.location.origin || event.source !== window.parent) return
  const message = event.data as HostToGuestMessage
  if (message?.type === 'neos-studio/select-node') {
    const element = message.aggregateId === null ? null : (elementsByAggregateId.get(message.aggregateId) ?? null)
    select(element, { notifyHost: false, reveal: true })
  }
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
  window.addEventListener('message', onHostMessage)
  post({ type: 'neos-studio/guest-ready' })
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}
