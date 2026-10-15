/**
 * postMessage protocol between the Studio shell (host) and the preview
 * iframe's guest script (src/guest/main.ts). Both sides run on the same
 * origin and must verify it on every message.
 *
 * Node identity travels as the raw value of the data-__neos-node-contextpath
 * attribute the edit-mode rendering emits (the attribute keeps its classic
 * name): the NodeAddress JSON (see ContentElementWrappingService). The
 * `nodeAddress` fields below carry that JSON; the host converts it to a
 * Studio node address via nodeAddressFromContextPath() (api/neos/schema).
 * The host->guest direction only needs the aggregateId - within one rendered
 * document it identifies the element.
 *
 * Lifecycle: the guest announces itself with guest-ready (carrying the label
 * catalogue it wants translated), the host answers with init. Before the
 * host retires a frame (a reload or navigation replaced it), it sends flush
 * and waits briefly for flushed, so inline edits still debouncing in that
 * frame are posted first; the guest also flushes on pagehide on its own.
 */

/**
 * The DOM attributes of an inline link (the <a> tag / TipTap link mark) as
 * they travel between guest and host while the Link Editor edits one. The
 * href is a Neos link URI (node://, asset://, https://, mailto:, ...); the
 * rest are the shared link options, null when unset.
 */
export interface LinkAttributes {
  href: string
  target: string | null
  rel: string | null
  class: string | null
  title: string | null
}

export type GuestToHostMessage =
  /**
   * The guest script booted and the DOM is indexed - selection can be pushed.
   * labels is the guest's UI string catalogue (key → English fallback); the
   * host answers with init carrying the translations.
   */
  | { type: 'neos-studio/guest-ready'; labels: Record<string, string> }
  /** The user clicked a content element; nodeAddress is the NodeAddress JSON. */
  | { type: 'neos-studio/node-selected'; nodeAddress: string }
  /**
   * The user clicked outside of any content element - the shell inspects the
   * current document instead (the guest does not know its address).
   */
  | { type: 'neos-studio/document-selected' }
  /** The user followed a link to another document (from its preview URI). */
  | { type: 'neos-studio/navigate-to-node'; nodeAddress: string }
  /**
   * An inline edit should be persisted (debounced while typing, on blur, on
   * flush and on pagehide).
   */
  | {
      type: 'neos-studio/property-changed'
      nodeAddress: string
      property: string
      value: string
    }
  /**
   * Live-typing stream (throttled): the current content of the inline text
   * being edited, for collaborators' previews. Ephemeral - persistence goes
   * through property-changed.
   */
  | {
      type: 'neos-studio/live-edit'
      nodeAddress: string
      property: string
      value: string
      /** The sender's caret as a ProseMirror document position in `value`. */
      cursor: number
    }
  /**
   * A node type dragged from the creation panel was dropped into a content
   * collection. The new node goes before the succeeding sibling, or to the
   * end of the collection when the sibling is null.
   */
  | {
      type: 'neos-studio/create-node-request'
      nodeTypeName: string
      parentNodeAddress: string
      succeedingSiblingNodeAddress: string | null
    }
  /**
   * The "..." handle of the selected content element was clicked - the host
   * shows the element menu (hide/delete, or unhide for hidden elements)
   * anchored at the handle's position (viewport coordinates within the
   * iframe).
   */
  | {
      type: 'neos-studio/element-menu-request'
      nodeAddress: string
      /** NodeAddress JSON of the enclosing collection, for post-delete focus. */
      parentNodeAddress: string | null
      /** The element is explicitly hidden (tagged "disabled"). */
      hidden: boolean
      buttonRect: { left: number; top: number; width: number; height: number }
    }
  /**
   * A "+" affordance in the preview was clicked - the host opens the
   * insertion dialog (mode + node type selection) relative to this node:
   * the element's "+" button (defaultMode "after") or the add button inside
   * an empty collection (defaultMode "inside", nodeAddress = the collection).
   */
  | {
      type: 'neos-studio/insert-node-request'
      nodeAddress: string
      /** NodeAddress JSON of the enclosing collection, for sibling modes. */
      parentNodeAddress: string | null
      defaultMode: 'inside' | 'after'
    }
  /**
   * A content element was dragged by its handle onto a new insertion point.
   * The element goes before the succeeding sibling, or to the end of the
   * collection when the sibling is null.
   */
  | {
      type: 'neos-studio/move-node-request'
      nodeAddress: string
      /** The collection the element came from - it needs refreshing too. */
      sourceParentNodeAddress: string | null
      parentNodeAddress: string
      succeedingSiblingNodeAddress: string | null
    }
  /**
   * The image-select button of a rendered image was clicked - the host opens
   * the Media Library picker and, on pick, sets the image property.
   * nodeAddress is the owning node's NodeAddress JSON, property the image
   * property name.
   */
  | {
      type: 'neos-studio/image-select-request'
      nodeAddress: string
      property: string
    }
  /**
   * The "Create variant" button over a shine-through element was clicked -
   * the host materializes the node in the viewed dimension (the same
   * CreateNodeVariant an edit would run implicitly) and reloads the preview.
   */
  | {
      type: 'neos-studio/create-variant-request'
      nodeAddress: string
    }
  /**
   * The link button of a rich-text toolbar was clicked - the host opens the
   * Link Editor dialog. attributes carry the existing link at the selection
   * (to edit), or null when a new link is being created. The guest keeps the
   * pending selection and waits for link-apply / link-cancel.
   */
  | {
      type: 'neos-studio/link-edit-request'
      attributes: LinkAttributes | null
    }
  /**
   * The user lost the edit-lock arbitration (a collaborator was faster into
   * the same element): the guest discarded the unpersisted keystrokes and
   * left the editor; the host informs the user. name is the lock holder's.
   */
  | { type: 'neos-studio/editing-rejected'; name: string }
  /**
   * Reply to element-info-request: where (and whether) the node is rendered
   * on this page. fusionPath is the element's rendering entry point (the
   * data-__neos-fusion-path attribute), null when the node has no rendered
   * element here - the host then falls back to a full reload for its own
   * edits and ignores remote ones (they concern another page).
   */
  | {
      type: 'neos-studio/element-info'
      requestId: number
      fusionPath: string | null
    }
  /**
   * Reply to replace-element: whether the swap happened. false (element gone,
   * unparseable fragment) tells the host to fall back to a full reload.
   */
  | {
      type: 'neos-studio/element-replaced'
      requestId: number
      ok: boolean
    }
  /**
   * Reply to flush: every pending (debounced) inline edit has been posted as
   * property-changed - the frame can be retired without losing keystrokes.
   */
  | { type: 'neos-studio/flushed'; requestId: number }

/**
 * A collaborator's live position on the rendered page: the element of the
 * node they focus gets an outline in their color plus an initials badge, and
 * the inline text they are editing is locked (read-only with an editing
 * badge) for everyone else.
 */
export interface PresenceHighlight {
  /** The node whose element they focus; null = none rendered on this page. */
  focusedAggregateId: string | null
  /** The element they hold the edit lock on (claimed by selection); property
   * names the inline text being typed in when known (badge placement). */
  editing: { aggregateId: string; property: string | null } | null
  color: string
  initials: string
  name: string
}

export type HostToGuestMessage =
  /**
   * Answer to guest-ready: the guest's label catalogue, translated into the
   * shell's interface language (keys the shell does not know keep their
   * English fallback).
   */
  | { type: 'neos-studio/init'; labels: Record<string, string> }
  /**
   * The host is about to retire this frame: post every pending inline edit
   * now and answer with flushed.
   */
  | { type: 'neos-studio/flush'; requestId: number }
  /**
   * Outline the element of this node and, unless `reveal` is false, scroll it into view; null
   * clears the selection.
   */
  | {
      type: 'neos-studio/select-node'
      aggregateId: string | null
      reveal?: boolean
    }
  /**
   * Pulse this element briefly. Sent when the editor arrives from a deep link and did not do the
   * selecting themselves, so the selection outline alone would be easy to miss. Ignored when the
   * node is not rendered on this page.
   */
  | { type: 'neos-studio/flash-node'; aggregateId: string }
  /**
   * The collaborators currently on this document and the elements they
   * focus. Replaces the previous set; an empty list clears all presence
   * decor (e.g. everyone left, or collaboration ended).
   */
  | { type: 'neos-studio/presence-update'; users: PresenceHighlight[] }
  /**
   * A node type drag from the creation panel started - the guest marks the
   * collections that allow this type as drop targets.
   */
  | { type: 'neos-studio/creation-drag-start'; nodeTypeName: string }
  /** The drag ended (dropped or cancelled anywhere) - clear the drop UI. */
  | { type: 'neos-studio/creation-drag-end' }
  /**
   * The Link Editor dialog was confirmed for the pending link-edit-request:
   * apply these attributes to the requesting selection - or remove the link
   * there when attributes is null.
   */
  | { type: 'neos-studio/link-apply'; attributes: LinkAttributes | null }
  /** The Link Editor dialog was dismissed - drop the pending link edit. */
  | { type: 'neos-studio/link-cancel' }
  /**
   * Ask where the node is rendered on this page (its fusion path), for an
   * out-of-band re-render. The guest answers with element-info.
   */
  | {
      type: 'neos-studio/element-info-request'
      requestId: number
      aggregateId: string
    }
  /**
   * Swap the node's rendered element for freshly rendered markup (an
   * out-of-band render after an edit): the guest replaces the DOM element,
   * re-indexes the subtree and remounts inline editing, then answers with
   * element-replaced.
   */
  | {
      type: 'neos-studio/replace-element'
      requestId: number
      aggregateId: string
      html: string
    }
  /**
   * A collaborator's live-typing stream tick: show this content in their
   * (locked) inline text. Ephemeral - the authoritative state follows via
   * the change feed once their edit persists.
   */
  | {
      type: 'neos-studio/live-edit-apply'
      aggregateId: string
      property: string
      value: string
      /** Their caret as a ProseMirror document position in `value` - drawn
       * as a colored caret line; null when the tick carried none. */
      cursor: number | null
    }

const isString = (value: unknown): value is string => typeof value === 'string'
const isStringOrNull = (value: unknown): boolean =>
  value === null || typeof value === 'string'
const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

/**
 * The fields every guest message must carry, by type - checked at runtime
 * before the host acts on a message (see isGuestToHostMessage).
 */
const GUEST_MESSAGE_FIELDS: {
  [Type in GuestToHostMessage['type']]: Record<
    Exclude<keyof Extract<GuestToHostMessage, { type: Type }>, 'type'>,
    (value: unknown) => boolean
  >
} = {
  'neos-studio/guest-ready': { labels: isRecord },
  'neos-studio/node-selected': { nodeAddress: isString },
  'neos-studio/document-selected': {},
  'neos-studio/navigate-to-node': { nodeAddress: isString },
  'neos-studio/property-changed': {
    nodeAddress: isString,
    property: isString,
    value: isString,
  },
  'neos-studio/live-edit': {
    nodeAddress: isString,
    property: isString,
    value: isString,
    cursor: isNumber,
  },
  'neos-studio/create-node-request': {
    nodeTypeName: isString,
    parentNodeAddress: isString,
    succeedingSiblingNodeAddress: isStringOrNull,
  },
  'neos-studio/element-menu-request': {
    nodeAddress: isString,
    parentNodeAddress: isStringOrNull,
    hidden: (value) => typeof value === 'boolean',
    buttonRect: (value) =>
      isRecord(value) &&
      isNumber(value.left) &&
      isNumber(value.top) &&
      isNumber(value.width) &&
      isNumber(value.height),
  },
  'neos-studio/insert-node-request': {
    nodeAddress: isString,
    parentNodeAddress: isStringOrNull,
    defaultMode: (value) => value === 'inside' || value === 'after',
  },
  'neos-studio/move-node-request': {
    nodeAddress: isString,
    sourceParentNodeAddress: isStringOrNull,
    parentNodeAddress: isString,
    succeedingSiblingNodeAddress: isStringOrNull,
  },
  'neos-studio/image-select-request': {
    nodeAddress: isString,
    property: isString,
  },
  'neos-studio/create-variant-request': { nodeAddress: isString },
  'neos-studio/link-edit-request': {
    attributes: (value) =>
      value === null || (isRecord(value) && isString(value.href)),
  },
  'neos-studio/editing-rejected': { name: isString },
  'neos-studio/element-info': {
    requestId: isNumber,
    fusionPath: isStringOrNull,
  },
  'neos-studio/element-replaced': {
    requestId: isNumber,
    ok: (value) => typeof value === 'boolean',
  },
  'neos-studio/flushed': { requestId: isNumber },
}

/**
 * Whether postMessage data is a well-formed guest message: a known type with
 * every field it needs, of the right type. The guest runs inside a page the
 * site renders - site scripts share its window and can post too - so the
 * host never trusts the shape of what arrives.
 */
export function isGuestToHostMessage(
  data: unknown,
): data is GuestToHostMessage {
  if (!isRecord(data) || !isString(data.type)) return false
  if (!Object.prototype.hasOwnProperty.call(GUEST_MESSAGE_FIELDS, data.type))
    return false
  const fields = GUEST_MESSAGE_FIELDS[
    data.type as GuestToHostMessage['type']
  ] as Record<string, (value: unknown) => boolean>
  return Object.entries(fields).every(([field, valid]) => valid(data[field]))
}
