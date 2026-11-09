/**
 * postMessage protocol between the Studio shell (host) and the compare
 * script rendered into the two side-by-side review frames
 * (src/compare/main.ts). Both sides run on the same origin and must verify
 * it on every message.
 *
 * The compare frames are the read-only sibling of the editing preview (see
 * features/preview/protocol.ts): the same edit-mode metadata markup, but
 * nothing is selected, edited or created here. What travels instead is what a
 * diff needs - where the changed elements are, and where the page is
 * scrolled - so the shell can mark the changes and keep the two frames
 * aligned.
 *
 * Node identity travels as the bare aggregate id: within one rendered
 * document it identifies an element, and both frames show the SAME document
 * in two workspaces - which is exactly what makes an aggregate id the pairing
 * key between them.
 */

/** Which version of the document a frame renders. */
export type CompareSide = 'base' | 'target'

/**
 * How a node differs from the base workspace - the vocabulary of the
 * document-diff resource (see WorkspaceDocumentDiffNode). A "removed" node
 * only exists in the base frame, a "created" one only in the target frame;
 * the rest exist in both and get marked on both sides.
 */
export type CompareStatus =
  'created' | 'removed' | 'moved' | 'changed' | 'variant'

/** One element to mark in a frame. */
export interface CompareMark {
  aggregateId: string
  status: CompareStatus
  /**
   * The badge caption, translated by the shell. The frames carry no i18n of
   * their own - they are a few KB of DOM decoration, not an application.
   */
  label: string
  /**
   * The properties that changed, for marking the rendered value instead of
   * the whole node. Load-bearing for the DOCUMENT node: its element wraps the
   * entire page, so outlining it says "something on this page changed" - true,
   * useless, and invisible at that size. Its inline-editable properties (a
   * hero headline, a lead text) are the parts that actually changed, and they
   * are what a reviewer needs pointed at. Empty for structural changes.
   */
  properties: string[]
}

/**
 * Where a content element sits in a rendered page: its top edge as a
 * document offset (what `window.scrollTo` takes), plus its height. Reported
 * for EVERY content element, not just the changed ones - the shell pairs the
 * ids present in both frames to translate one frame's scroll position into
 * the other's, which is what makes synchronized scrolling survive pages of
 * different heights.
 */
export interface CompareAnchor {
  aggregateId: string
  top: number
  height: number
}

/**
 * Where a mark actually landed. Reported separately from the anchors because
 * a mark does not necessarily sit on a content element's wrapper: a document
 * property is marked on the rendered property, which the anchors know
 * nothing about. `top` is null when this frame renders nothing for the mark -
 * a creation in the base frame, a removal in the target frame, or a change
 * that has no visible representation on the page at all (an SEO title, a
 * navigation label).
 */
export interface CompareMarkPlacement {
  aggregateId: string
  top: number | null
}

/** A frame's scroll geometry, reported alongside its anchors. */
export interface CompareMetrics {
  anchors: CompareAnchor[]
  placements: CompareMarkPlacement[]
  scrollHeight: number
  viewportHeight: number
}

export type CompareGuestToHostMessage =
  /**
   * The compare script booted and the page is measured. Carries the first
   * metrics, so the shell never has to ask for them.
   */
  | { type: 'neos-studio/compare-ready'; metrics: CompareMetrics }
  /**
   * The page was re-measured: marks were applied, images loaded, fonts
   * swapped in, the frame was resized. Anchors and placements move when that
   * happens, and stale ones would drift the scroll sync and the change
   * navigation.
   */
  | { type: 'neos-studio/compare-metrics'; metrics: CompareMetrics }
  /**
   * The user scrolled this frame. Not sent while the frame is executing a
   * scroll the shell asked for - that echo would bounce the two frames off
   * each other.
   */
  | { type: 'neos-studio/compare-scroll'; scrollTop: number }

export type CompareHostToGuestMessage =
  /**
   * The changed elements of this document. Replaces the previous set; marks
   * whose node is not rendered in this frame are silently skipped, which is
   * what lets the shell send one list to both frames (a creation renders only
   * in the target, a removal only in the base). `documentAggregateId` names
   * the page itself - the node whose element is the whole page and therefore
   * must be marked through its properties (see CompareMark.properties).
   */
  | {
      type: 'neos-studio/compare-marks'
      marks: CompareMark[]
      documentAggregateId: string
    }
  /**
   * Scroll the frame. `smooth` is for the change navigation (a visible jump
   * the eye can follow); the scroll sync uses instant scrolling, or the two
   * frames would lag behind each other by an animation.
   */
  | {
      type: 'neos-studio/compare-scroll-to'
      scrollTop: number
      smooth: boolean
    }
  /**
   * Emphasize one marked element (the change the navigation is currently on)
   * and dim the emphasis on the others; null clears it.
   */
  | { type: 'neos-studio/compare-focus'; aggregateId: string | null }
