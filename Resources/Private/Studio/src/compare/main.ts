/**
 * The Studio compare script: injected by the PreviewController into the
 * edit-mode preview responses of the side-by-side review frames
 * (?compare=1). Built standalone via vite.compare.config.ts, like the
 * editing guest and with no dependency on the SPA bundle.
 *
 * It is the read-only sibling of src/guest/main.ts. Both work on the same
 * metadata markup Neos emits in edit mode - data-__neos-node-contextpath
 * carries a content element's NodeAddress as JSON, data-__neos-property plus
 * data-__neos-editable-node-contextpath mark the rendered value of an
 * inline-editable property - but this one never selects, edits or creates
 * anything. Its whole job is to make one rendered version of a page
 * comparable to another:
 *
 * - mark the elements the shell tells it changed, in the change colors of
 *   the rest of the Studio (additions green, removals red, edits blue,
 *   dimension variants purple)
 * - report where every content element sits, so the shell can pair the two
 *   frames by aggregate id and keep them scrolled to the same content, and
 *   where each mark landed, so it can step through the changes
 * - report and execute scrolling
 *
 * Everything the editing guest offers is absent by construction: it is a
 * different script, so there is no interactive affordance to disable and no
 * way to click into an edit. Links and form submits are swallowed on top -
 * navigating one frame away from the compared document would silently break
 * the pairing.
 */
import type {
  CompareAnchor,
  CompareGuestToHostMessage,
  CompareHostToGuestMessage,
  CompareMark,
  CompareMarkPlacement,
  CompareMetrics,
  CompareStatus,
} from '../features/compare/protocol'

const WRAPPER_ATTRIBUTE = 'data-__neos-node-contextpath'
const HIDDEN_ATTRIBUTE = 'data-__neos-studio-hidden'
/** The rendered value of an inline-editable property, and its owning node. */
const PROPERTY_ATTRIBUTE = 'data-__neos-property'
const EDITABLE_NODE_ATTRIBUTE = 'data-__neos-editable-node-contextpath'
/** The node property a rendered image came from (see this package's Root.fusion). */
const IMAGE_PROPERTY_ATTRIBUTE = 'data-__neos-studio-image-property'
/**
 * The node properties an element stands for, comma separated - the site's own
 * way of telling the compare view where a property ended up.
 *
 * Neos marks the properties it renders through its own editing markup, which
 * covers inline-editable text and little else. Everything a site renders into
 * something other than editable text - an image, an alt text, a link target, a
 * background, an aria-label - is invisible to that markup, and a change to it
 * has nothing to point at. A site that knows better says so:
 *
 *   <img data-__neos-studio-properties="heroImage,heroImageAlternativeText" />
 *
 * Purely additive: without it nothing breaks, the change simply reads out in
 * the compare view's detail panel instead of being marked on the page.
 */
const PROPERTIES_ATTRIBUTE = 'data-__neos-studio-properties'

/** Carries the mark's status, so one CSS rule per status styles them all. */
const MARK_ATTRIBUTE = 'data-neos-compare'
/** Carries the badge caption, rendered through content: attr(). */
const LABEL_ATTRIBUTE = 'data-neos-compare-label'
/** The marked node, for focusing a mark placed on a property element. */
const MARK_ID_ATTRIBUTE = 'data-neos-compare-id'
/** The element the change navigation currently sits on. */
const FOCUS_CLASS = 'neos-compare-focus'
/** Set on marked elements whose own position is static - see applyMark(). */
const ANCHORED_CLASS = 'neos-compare-anchored'
/** The badge would be clipped above the page - it hangs inside instead. */
const INSET_CLASS = 'neos-compare-inset'

/**
 * The change tones of the Studio (see features/workspaces/historyLabels.ts),
 * as literal RGB triples - the frames carry no Tailwind.
 */
const TONE_COLORS: Record<CompareStatus, string> = {
  created: '34, 197, 94',
  removed: '239, 68, 68',
  moved: '59, 130, 246',
  changed: '59, 130, 246',
  variant: '168, 85, 247',
}

function post(message: CompareGuestToHostMessage): void {
  window.parent.postMessage(message, window.location.origin)
}

/** Content elements by aggregate id - the pairing key between the frames. */
const elementsByAggregateId = new Map<string, HTMLElement>()
/** Rendered inline-editable properties by aggregate id, then property name. */
const propertyElements = new Map<string, Map<string, HTMLElement[]>>()

/** The elements currently carrying a mark, so a new set can clear the old. */
let markedElements: HTMLElement[] = []
/** Where the current marks landed, reported with every measurement. */
let placements: CompareMarkPlacement[] = []

/**
 * Scroll events fired before this timestamp are the frame executing a scroll
 * the shell asked for, not the user scrolling. Reporting them would bounce
 * the two frames off each other indefinitely.
 */
let echoSuppressedUntil = 0

function injectStyles(): void {
  const style = document.createElement('style')
  const toneRules = Object.entries(TONE_COLORS)
    .map(
      ([status, color]) => `
    [${MARK_ATTRIBUTE}="${status}"] {
      outline: 2px solid rgb(${color});
      outline-offset: 3px;
      background-color: rgba(${color}, 0.08);
    }
    [${MARK_ATTRIBUTE}="${status}"]::before {
      background-color: rgb(${color});
    }`,
    )
    .join('\n')
  style.textContent = `
    /* A site's own smooth scrolling would make the frames lag behind each
       other by an animation. Programmatic scrolls pass their behavior
       explicitly, which wins over this. */
    html, body {
      scroll-behavior: auto !important;
    }
    /* Nothing in here is interactive - say so, and keep text selection from
       looking like the start of an edit. */
    [${WRAPPER_ATTRIBUTE}] {
      cursor: default;
    }
    [${MARK_ATTRIBUTE}] {
      /* outline, not border: it draws outside the box, so marking an element
         never reflows the page - and the two frames stay comparable. */
      transition: outline-color 150ms ease, background-color 150ms ease;
    }
    .${ANCHORED_CLASS} {
      position: relative;
    }
    [${MARK_ATTRIBUTE}]::before {
      content: attr(${LABEL_ATTRIBUTE});
      position: absolute;
      top: 0;
      left: 0;
      z-index: 10000;
      transform: translateY(-100%);
      padding: 1px 6px;
      border-radius: 3px 3px 0 0;
      font: 600 11px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0.01em;
      color: #fff;
      white-space: nowrap;
      pointer-events: none;
    }
    /* Nothing above the element to hang the badge in - it sits inside, with
       the corner radius flipped so it still reads as attached to the top. */
    [${MARK_ATTRIBUTE}].${INSET_CLASS}::before {
      transform: none;
      border-radius: 0 0 3px 0;
    }
    /* The change the navigation is on: a thicker outline and a halo, so it
       stands out from the other marks already on the page. */
    [${MARK_ATTRIBUTE}].${FOCUS_CLASS} {
      outline-width: 3px;
      box-shadow: 0 0 0 6px rgba(255, 255, 255, 0.35);
    }
    /* Explicitly hidden elements read as invisible-to-visitors here as well -
       the same dimming the editing guest applies. */
    [${WRAPPER_ATTRIBUTE}][${HIDDEN_ATTRIBUTE}] {
      opacity: 0.5;
    }
    ${toneRules}
  `
  document.head.appendChild(style)
}

/** The aggregate id inside a NodeAddress JSON attribute, or null. */
function aggregateIdIn(element: HTMLElement, attribute: string): string | null {
  const raw = element.getAttribute(attribute)
  if (!raw) return null
  try {
    const address = JSON.parse(raw) as { aggregateId?: unknown }
    return typeof address.aggregateId === 'string' ? address.aggregateId : null
  } catch {
    return null
  }
}

function indexElements(): void {
  elementsByAggregateId.clear()
  propertyElements.clear()
  for (const element of document.querySelectorAll<HTMLElement>(
    `[${WRAPPER_ATTRIBUTE}]`,
  )) {
    const id = aggregateIdIn(element, WRAPPER_ATTRIBUTE)
    // First wins: a node rendered twice on one page (a teaser of itself)
    // pairs on its first occurrence, the same way in both frames.
    if (id !== null && !elementsByAggregateId.has(id)) {
      elementsByAggregateId.set(id, element)
    }
  }
  for (const element of document.querySelectorAll<HTMLElement>(
    `[${EDITABLE_NODE_ATTRIBUTE}][${PROPERTY_ATTRIBUTE}]`,
  )) {
    const id = aggregateIdIn(element, EDITABLE_NODE_ATTRIBUTE)
    const property = element.getAttribute(PROPERTY_ATTRIBUTE)
    if (id === null || property === null) continue
    rememberProperty(id, property, element)
  }
  // An image can name the property it was rendered from - this package stamps
  // that onto images rendered through Neos.Neos:ImageTag (see Root.fusion),
  // which is what lets a changed image property point at the image rather than
  // at the element around it. Only images INSIDE a node count: the same
  // attribute also sits on content elements that have exactly one image
  // property, and those are already covered by their own wrapper.
  //
  // A site that renders its images some other way (a Kaleidoscope component, a
  // hand-written <img> off an ImageUri) stamps nothing, so nothing is indexed
  // here and its image changes fall back to the element outline - or, for the
  // page's own image properties, to the detail panel.
  for (const element of document.querySelectorAll<HTMLElement>(
    `[${IMAGE_PROPERTY_ATTRIBUTE}]:not([${WRAPPER_ATTRIBUTE}])`,
  )) {
    const owner = element.closest<HTMLElement>(`[${WRAPPER_ATTRIBUTE}]`)
    const id = owner === null ? null : aggregateIdIn(owner, WRAPPER_ATTRIBUTE)
    const property = element.getAttribute(IMAGE_PROPERTY_ATTRIBUTE)
    if (id === null || property === null) continue
    rememberProperty(id, property, element)
  }
  // What the site itself declares (see PROPERTIES_ATTRIBUTE). Last, so an
  // explicit declaration lands alongside whatever was derived above.
  for (const element of document.querySelectorAll<HTMLElement>(
    `[${PROPERTIES_ATTRIBUTE}]`,
  )) {
    const owner = element.closest<HTMLElement>(`[${WRAPPER_ATTRIBUTE}]`)
    const id = owner === null ? null : aggregateIdIn(owner, WRAPPER_ATTRIBUTE)
    if (id === null) continue
    for (const property of (element.getAttribute(PROPERTIES_ATTRIBUTE) ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name !== '')) {
      rememberProperty(id, property, element)
    }
  }
}

function rememberProperty(
  aggregateId: string,
  property: string,
  element: HTMLElement,
): void {
  let byProperty = propertyElements.get(aggregateId)
  if (!byProperty) {
    byProperty = new Map()
    propertyElements.set(aggregateId, byProperty)
  }
  const list = byProperty.get(property)
  if (list) {
    if (!list.includes(element)) list.push(element)
  } else {
    byProperty.set(property, [element])
  }
}

/** The rendered values of a node's changed properties, if any are on the page. */
function propertyTargets(mark: CompareMark): HTMLElement[] {
  const byProperty = propertyElements.get(mark.aggregateId)
  if (!byProperty) return []
  const targets: HTMLElement[] = []
  for (const property of mark.properties) {
    const elements = byProperty.get(property)
    if (elements) targets.push(...elements)
  }
  return targets
}

/**
 * What to outline for one mark.
 *
 * For an ordinary content element that is its own element: outlining it says
 * "this element changed", which is what a reviewer wants to see - including
 * for changes with nothing rendered of their own (a move, a new element).
 *
 * The DOCUMENT node is the exception, and the reason this function exists.
 * Its element is the whole page, so outlining it draws a rectangle around
 * everything - offscreen at the top, invisible at that size, and true of any
 * change whatsoever. What actually changed are its properties (a hero
 * headline, a lead text), and those render as inline-editable values in the
 * middle of the page. Those get the mark.
 */
function resolveTargets(
  mark: CompareMark,
  documentAggregateId: string,
): HTMLElement[] {
  // Whatever else happens, never the page itself: an outline around
  // everything points at nothing.
  const pageElement = elementsByAggregateId.get(documentAggregateId) ?? null
  const usable = (elements: HTMLElement[]) =>
    elements.filter((element) => element !== pageElement)

  if (mark.aggregateId === documentAggregateId) {
    return usable(propertyTargets(mark))
  }
  const wrapper = elementsByAggregateId.get(mark.aggregateId)
  if (wrapper) return usable([wrapper])
  // A node the site renders without the content-element wrapper: its
  // properties are still stamped, and they are what changed.
  return usable(propertyTargets(mark))
}

function applyMark(element: HTMLElement, mark: CompareMark): void {
  element.setAttribute(MARK_ATTRIBUTE, mark.status)
  element.setAttribute(LABEL_ATTRIBUTE, mark.label)
  element.setAttribute(MARK_ID_ATTRIBUTE, mark.aggregateId)
  // The badge is absolutely positioned inside the element, so the element
  // has to be a containing block. Only elements that are not positioned
  // already get one - overriding a site's own `position` would move
  // whatever it was holding in place.
  if (window.getComputedStyle(element).position === 'static') {
    element.classList.add(ANCHORED_CLASS)
  }
  // An element flush with the top of the page has no room above it for the
  // badge - it would be clipped away and the change would read as unmarked.
  const top = element.getBoundingClientRect().top + window.scrollY
  if (top < 24) element.classList.add(INSET_CLASS)
  markedElements.push(element)
}

function markElements(marks: CompareMark[], documentAggregateId: string): void {
  for (const element of markedElements) {
    element.removeAttribute(MARK_ATTRIBUTE)
    element.removeAttribute(LABEL_ATTRIBUTE)
    element.removeAttribute(MARK_ID_ATTRIBUTE)
    element.classList.remove(ANCHORED_CLASS, FOCUS_CLASS, INSET_CLASS)
  }
  markedElements = []
  placements = []

  for (const mark of marks) {
    // Nothing rendered here: a creation has no element in the base frame, a
    // removal none in the target frame. One mark list serves both.
    const targets = resolveTargets(mark, documentAggregateId)
    for (const target of targets) applyMark(target, mark)
    placements.push({
      aggregateId: mark.aggregateId,
      top: targets.length === 0 ? null : topOf(targets),
    })
  }
}

/** The topmost of a mark's elements, as a document offset. */
function topOf(elements: HTMLElement[]): number {
  const scrollY = window.scrollY
  return Math.round(
    Math.min(
      ...elements.map(
        (element) => element.getBoundingClientRect().top + scrollY,
      ),
    ),
  )
}

function measure(): CompareMetrics {
  const scrollY = window.scrollY
  const anchors: CompareAnchor[] = []
  for (const [aggregateId, element] of elementsByAggregateId) {
    const rect = element.getBoundingClientRect()
    // Elements a site collapsed away (display:none renders a zero rect at the
    // origin) would anchor the whole page to offset 0 and wreck the sync.
    if (rect.height === 0 && rect.width === 0) continue
    anchors.push({
      aggregateId,
      top: Math.round(rect.top + scrollY),
      height: Math.round(rect.height),
    })
  }
  anchors.sort((a, b) => a.top - b.top)
  // Re-read where the marks sit: images and fonts move them after marking.
  const marked = new Map<string, HTMLElement[]>()
  for (const element of markedElements) {
    const id = element.getAttribute(MARK_ID_ATTRIBUTE)
    if (id === null) continue
    const list = marked.get(id)
    if (list) list.push(element)
    else marked.set(id, [element])
  }
  return {
    anchors,
    placements: placements.map((placement) => {
      const elements = marked.get(placement.aggregateId)
      return {
        aggregateId: placement.aggregateId,
        top: elements === undefined ? null : topOf(elements),
      }
    }),
    scrollHeight: Math.round(
      document.scrollingElement?.scrollHeight ?? document.body.scrollHeight,
    ),
    viewportHeight: Math.round(window.innerHeight),
  }
}

/** Cheap identity of a metrics snapshot, to keep unchanged ones off the wire. */
function signatureOf(metrics: CompareMetrics): string {
  return [
    metrics.scrollHeight,
    metrics.viewportHeight,
    metrics.anchors.map((a) => `${a.aggregateId}@${a.top}`).join(','),
    metrics.placements.map((p) => `${p.aggregateId}@${p.top}`).join(','),
  ].join(':')
}

let lastSignature = ''
let measureTimer: number | null = null

/**
 * Re-measure and report, coalesced: images arriving, fonts swapping in and a
 * resized frame all move the anchors, and they arrive in bursts.
 */
function scheduleMeasure(): void {
  if (measureTimer !== null) return
  measureTimer = window.setTimeout(() => {
    measureTimer = null
    const metrics = measure()
    const signature = signatureOf(metrics)
    if (signature === lastSignature) return
    lastSignature = signature
    post({ type: 'neos-studio/compare-metrics', metrics })
  }, 120)
}

/**
 * A page keeps moving long after it is "loaded". Lazily loaded hero images
 * are the worst of it: they are not part of the load event, they arrive with
 * no reserved height, and everything below them jumps down when they do -
 * the marked change included, several hundred pixels away from where it was
 * measured. Every measurement the shell holds would be wrong from then on,
 * and it has no way of knowing.
 *
 * So the page is re-measured whenever anything could have moved it, and a few
 * times regardless.
 */
function watchLayout(): void {
  const observer = new ResizeObserver(scheduleMeasure)
  // The body, not just the root: a page whose html element is viewport-sized
  // (height: 100%) grows only in its body, and the root observer alone would
  // never fire.
  observer.observe(document.documentElement)
  observer.observe(document.body)
  // Media loading fires on the element, and load events do not bubble - the
  // capture phase is how one listener sees all of them.
  document.addEventListener('load', scheduleMeasure, true)
  window.addEventListener('resize', scheduleMeasure)
  window.addEventListener('load', scheduleMeasure)
  document.fonts?.ready.then(scheduleMeasure).catch(() => undefined)
}

/**
 * The backstop for layout the observers above cannot see - a slider that
 * initializes itself, a script that measures and grows a section. Cheap:
 * a measurement that changed nothing is never sent (see scheduleMeasure).
 */
function settleMeasurements(): void {
  for (const delay of [300, 900, 2000, 4000]) {
    window.setTimeout(scheduleMeasure, delay)
  }
}

let scrollTimer: number | null = null

/**
 * Report the scroll position, throttled. Deliberately a timer and not
 * requestAnimationFrame: a frame callback does not run while its page is
 * throttled (a background tab, an occluded frame), and one that never runs
 * would leave the throttle latched forever - scroll synchronization would
 * die silently and stay dead. A timer always fires eventually.
 */
function onScroll(): void {
  if (scrollTimer !== null) return
  scrollTimer = window.setTimeout(() => {
    scrollTimer = null
    if (performance.now() < echoSuppressedUntil) return
    post({ type: 'neos-studio/compare-scroll', scrollTop: window.scrollY })
  }, 16)
}

function scrollToPosition(scrollTop: number, smooth: boolean): void {
  // The echo window covers the scroll itself; a smooth one runs for a few
  // hundred milliseconds and reports all the way through it.
  echoSuppressedUntil = performance.now() + (smooth ? 900 : 150)
  window.scrollTo({ top: scrollTop, behavior: smooth ? 'smooth' : 'instant' })
}

function focusElement(aggregateId: string | null): void {
  for (const element of markedElements) {
    element.classList.toggle(
      FOCUS_CLASS,
      aggregateId !== null &&
        element.getAttribute(MARK_ID_ATTRIBUTE) === aggregateId,
    )
  }
}

function onHostMessage(event: MessageEvent): void {
  if (event.origin !== window.location.origin) return
  if (event.source !== window.parent) return
  const message = event.data as CompareHostToGuestMessage
  switch (message?.type) {
    case 'neos-studio/compare-marks':
      markElements(message.marks, message.documentAggregateId)
      // The placements are new - the change navigation runs on them. The
      // marks usually arrive after the initial settling window has passed
      // (they wait for the diff request), so it starts over for them.
      scheduleMeasure()
      settleMeasurements()
      break
    case 'neos-studio/compare-scroll-to':
      scrollToPosition(message.scrollTop, message.smooth)
      break
    case 'neos-studio/compare-focus':
      focusElement(message.aggregateId)
      break
  }
}

/**
 * Following a link would navigate the frame away from the compared document,
 * leaving the two sides showing different pages with no way back. Swallowed
 * in the capture phase so a site's own handlers never run either.
 */
function swallowNavigation(): void {
  document.addEventListener(
    'click',
    (event) => {
      const target = event.target as Element | null
      if (target?.closest('a[href], button, [role="button"]')) {
        event.preventDefault()
        event.stopPropagation()
      }
    },
    true,
  )
  document.addEventListener('submit', (event) => event.preventDefault(), true)
}

function boot(): void {
  injectStyles()
  indexElements()
  swallowNavigation()

  window.addEventListener('message', onHostMessage)
  window.addEventListener('scroll', onScroll, { passive: true })
  watchLayout()
  settleMeasurements()

  const metrics = measure()
  lastSignature = signatureOf(metrics)
  post({ type: 'neos-studio/compare-ready', metrics })
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot)
} else {
  boot()
}
