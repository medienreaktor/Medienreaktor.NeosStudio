import * as React from 'react'
import type { PresenceUser } from '@/api/collaboration'

/**
 * A colleague present in the same editing workspace, enriched with the
 * client-side display attributes (color, initials). The own user is never a
 * peer - the roster is filtered before it lands here.
 */
export interface PresencePeer extends PresenceUser {
  color: string
  initials: string
}

export interface PresenceState {
  /** Editing in a shared workspace - presence indicators are live. */
  active: boolean
  peers: PresencePeer[]
  /** The own Neos user id, once the first heartbeat answered. */
  you: string | null
}

const INACTIVE: PresenceState = { active: false, peers: [], you: null }

/**
 * Who else is in the editing workspace right now. Deliberately its own
 * context (not part of useStudio()): presence is an overlay every consumer
 * can opt into, and outside a collaborative session the default inactive
 * state renders nothing - trees and panels work unchanged without the
 * provider.
 */
const PresenceContext = React.createContext<PresenceState>(INACTIVE)

export const PresenceProvider = PresenceContext.Provider

export function usePresence(): PresenceState {
  return React.useContext(PresenceContext)
}
