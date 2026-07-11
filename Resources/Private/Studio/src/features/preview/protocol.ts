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
  /** An inline edit was committed (blur with changed content). */
  | { type: 'neos-studio/property-changed'; contextPath: string; property: string; value: string }

export type HostToGuestMessage =
  /** Outline and reveal the element of this node; null clears the selection. */
  | { type: 'neos-studio/select-node'; aggregateId: string | null }
