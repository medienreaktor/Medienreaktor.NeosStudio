import type { GuestToHostMessage } from '../features/preview/protocol'

/**
 * Send a message to the Studio shell. The guest only ever talks to its
 * parent, on the same origin - the host verifies both on every message.
 */
export function post(message: GuestToHostMessage): void {
  window.parent.postMessage(message, window.location.origin)
}
