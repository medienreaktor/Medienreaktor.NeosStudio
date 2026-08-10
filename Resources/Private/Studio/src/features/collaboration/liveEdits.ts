/**
 * The live-typing channel: throttled content ticks of the inline text a user
 * is currently editing, streamed to collaborators so they watch the text
 * change keystroke by keystroke instead of waiting for the next persisted
 * save (which stays the authoritative path, via the change feed).
 *
 * A module-level pub/sub instead of React state on purpose: ticks arrive
 * every ~200ms while someone types, and routing them through App state would
 * re-render the shell on every one. The PreviewPane publishes local ticks
 * (from the guest) and subscribes to remote ones (to the guest); the
 * CollaborationBridge connects both to the realtime transport. Without the
 * sidecar nothing subscribes on the outgoing side and ticks simply vanish -
 * live typing is a realtime-only affordance by design.
 */
export interface LiveEdit {
  nodeAggregateId: string
  /** Unlike the lock claim, a live tick always names its concrete text. */
  property: string
  value: string
}

type Listener = (edit: LiveEdit) => void

const localListeners = new Set<Listener>()
const remoteListeners = new Set<Listener>()

/** The own user's typing tick (guest -> transport). */
export function publishLocalLiveEdit(edit: LiveEdit): void {
  for (const listener of localListeners) listener(edit)
}

export function subscribeLocalLiveEdits(listener: Listener): () => void {
  localListeners.add(listener)
  return () => localListeners.delete(listener)
}

/** A collaborator's typing tick (transport -> guest). */
export function publishRemoteLiveEdit(edit: LiveEdit): void {
  for (const listener of remoteListeners) listener(edit)
}

export function subscribeRemoteLiveEdits(listener: Listener): () => void {
  remoteListeners.add(listener)
  return () => remoteListeners.delete(listener)
}
