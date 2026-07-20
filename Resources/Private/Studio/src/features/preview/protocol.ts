/**
 * postMessage protocol between the Studio shell (host) and the preview
 * iframe's guest script (src/guest/main.ts). Both sides run on the same
 * origin and must verify it on every message.
 *
 * Node identity travels as the raw value of the data-__neos-node-contextpath
 * attribute the edit-mode rendering emits: the NodeAddress JSON (see
 * ContentElementWrappingService). The host converts it to a Studio node
 * address via addressFromContextPath(). The host->guest direction only needs
 * the aggregateId - within one rendered document it identifies the element.
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
  /** The guest script booted and the DOM is indexed - selection can be pushed. */
  | { type: 'neos-studio/guest-ready' }
  /** The user clicked a content element; contextPath is the NodeAddress JSON. */
  | { type: 'neos-studio/node-selected'; contextPath: string }
  /** The user followed a link to another document (from its preview URI). */
  | { type: 'neos-studio/navigate-to-node'; contextPath: string }
  /** An inline edit was committed (blur with changed content). */
  | {
      type: 'neos-studio/property-changed'
      contextPath: string
      property: string
      value: string
    }
  /**
   * A node type dragged from the creation panel was dropped into a content
   * collection. The new node goes before the succeeding sibling, or to the
   * end of the collection when the sibling is null.
   */
  | {
      type: 'neos-studio/create-node-request'
      nodeTypeName: string
      parentContextPath: string
      succeedingSiblingContextPath: string | null
    }
  /**
   * The "..." handle of the selected content element was clicked - the host
   * shows the element menu (hide/delete, or unhide for hidden elements)
   * anchored at the handle's position (viewport coordinates within the
   * iframe).
   */
  | {
      type: 'neos-studio/element-menu-request'
      contextPath: string
      /** NodeAddress JSON of the enclosing collection, for post-delete focus. */
      parentContextPath: string | null
      /** The element is explicitly hidden (tagged "disabled"). */
      hidden: boolean
      buttonRect: { left: number; top: number; width: number; height: number }
    }
  /**
   * A content element was dragged by its handle onto a new insertion point.
   * The element goes before the succeeding sibling, or to the end of the
   * collection when the sibling is null.
   */
  | {
      type: 'neos-studio/move-node-request'
      nodeContextPath: string
      /** The collection the element came from - it needs refreshing too. */
      sourceParentContextPath: string | null
      parentContextPath: string
      succeedingSiblingContextPath: string | null
    }
  /**
   * The image-select button of a rendered image was clicked - the host opens
   * the Media Library picker and, on pick, sets the image property. contextPath
   * is the owning node's NodeAddress JSON, property the image property name.
   */
  | {
      type: 'neos-studio/image-select-request'
      contextPath: string
      property: string
    }
  /**
   * The "Create variant" button over a shine-through element was clicked -
   * the host materializes the node in the viewed dimension (the same
   * CreateNodeVariant an edit would run implicitly) and reloads the preview.
   */
  | {
      type: 'neos-studio/create-variant-request'
      contextPath: string
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
   * Reply to element-info-request: where (and whether) the node is rendered
   * on this page. fusionPath is the element's rendering entry point (the
   * data-__neos-fusion-path attribute), null when the node has no rendered
   * element here - the host then falls back to a full reload.
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

export type HostToGuestMessage =
  /** Outline and reveal the element of this node; null clears the selection. */
  | { type: 'neos-studio/select-node'; aggregateId: string | null }
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
