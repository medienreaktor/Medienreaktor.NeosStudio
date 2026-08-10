import type {
  EditingElement,
  PresenceUser,
  WorkspaceFeedEvent,
} from '@/api/collaboration'
import type { DimensionSpacePoint } from '@/api/dimensions'
import type { LiveEdit } from './liveEdits'

/** "Where am I": what a presence announcement carries. */
export interface CollaborationPosition {
  documentAggregateId: string | null
  focusedAggregateId: string | null
  dimensionSpacePoint: DimensionSpacePoint | null
  /** The inline text being edited right now - peers lock it. */
  editingElement: EditingElement | null
}

/**
 * What a transport reports back to the CollaborationBridge. Transports only
 * move raw payloads; the bridge owns their interpretation (self- and
 * dimension-filtering of feed events, content-vs-structure classification,
 * roster dedup) so polling and WebSocket behave identically.
 */
export interface TransportCallbacks {
  /**
   * The full presence roster of the workspace. `you` is the own user id when
   * the server stamped it (the polling heartbeat answers with it); null when
   * the transport does not know (the bridge falls back to /me's id).
   */
  onRoster: (users: PresenceUser[], you: string | null) => void
  /** A batch of new feed events, oldest first. */
  onEvents: (events: WorkspaceFeedEvent[]) => void
  /**
   * The workspace content changed wholesale (publish/discard/rebase forked
   * the stream, the feed overflowed, or the transport missed a window) -
   * incremental updates cannot describe this.
   */
  onWorkspaceChanged: () => void
  /**
   * A collaborator's live-typing tick. Only push transports deliver these;
   * polling has no live typing (the change feed shows saves instead).
   */
  onLiveEdit?: (edit: LiveEdit) => void
}

export interface CollaborationTransport {
  /** Announce a moved position (document/focus/dimension/editing) right away. */
  updatePosition(position: CollaborationPosition): void
  /**
   * Stream the own user's live-typing tick to collaborators. Optional:
   * polling cannot carry a 200ms stream and simply does not implement it.
   */
  sendLiveEdit?(edit: LiveEdit): void
  /** Tear down loops/connections; announces leaving where possible. */
  stop(): void
}
