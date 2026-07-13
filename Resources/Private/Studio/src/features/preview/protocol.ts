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
