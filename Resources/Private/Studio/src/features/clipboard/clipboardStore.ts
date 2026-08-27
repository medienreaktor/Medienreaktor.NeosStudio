import { useSyncExternalStore } from 'react'

/**
 * The node clipboard: cut/copied nodes waiting to be pasted, held in plain
 * client state (deliberately not persisted - a cut refers to live workspace
 * structure, and a reload starts a fresh editing session anyway).
 *
 * Entries are a history, newest first, with exactly one active entry - the
 * one a paste inserts. Cutting/copying activates the new entry; the Clipboard
 * panel re-activates older ones. Entries are kind-separated: a document can
 * only be pasted in the document tree, content only in the content outliner,
 * never mixed. One cut/copy gesture is one entry: a multi-selection is
 * captured as a group, and pasting inserts the whole group in order.
 */

/** Which tree an entry belongs to - paste is only offered for the same kind. */
export type ClipboardKind = 'document' | 'content'

export type ClipboardMode = 'copy' | 'cut'

/** One captured node of a clipboard entry. */
export interface ClipboardNode {
  /** Encoded address of the source node at cut/copy time. */
  address: string
  aggregateId: string
  nodeType: string
  /** Display snapshot from cut/copy time - not refreshed. */
  label: string
  /** The source's parent - its children list shrinks when a cut is pasted. */
  sourceParentAddress: string | null
}

export interface ClipboardEntry {
  /** Stable identity of the history entry (not of its nodes). */
  id: string
  mode: ClipboardMode
  kind: ClipboardKind
  /**
   * The captured nodes in document order - never empty. A single right-click
   * capture holds one node, a multi-selection capture all selected ones;
   * pasting inserts them all, keeping this order.
   */
  nodes: ClipboardNode[]
}

export interface ClipboardState {
  /** Newest first. */
  entries: ClipboardEntry[]
  activeId: string | null
}

/** History cap - pastes address the active entry, the rest is convenience. */
const MAX_ENTRIES = 20

let state: ClipboardState = { entries: [], activeId: null }
const listeners = new Set<() => void>()

function setState(next: ClipboardState): void {
  state = next
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The clipboard state; re-renders on every clipboard change. */
export function useClipboard(): ClipboardState {
  return useSyncExternalStore(subscribe, () => state)
}

/** The entry a paste would insert, or null when the clipboard is empty. */
export function activeClipboardEntry(): ClipboardEntry | null {
  return state.entries.find((entry) => entry.id === state.activeId) ?? null
}

/**
 * Put one cut/copy gesture's nodes on the clipboard as a single entry and
 * make it the active one. An existing entry capturing the same nodes is
 * replaced (cutting what you copied earlier updates it rather than leaving
 * both in the history).
 */
export function clipboardAdd(
  mode: ClipboardMode,
  kind: ClipboardKind,
  nodes: ClipboardNode[],
): void {
  if (nodes.length === 0) return
  const entry: ClipboardEntry = {
    id: crypto.randomUUID(),
    mode,
    kind,
    nodes,
  }
  const sameNodes = (other: ClipboardEntry) =>
    other.nodes.length === nodes.length &&
    other.nodes.every((node, index) => node.address === nodes[index].address)
  const entries = [entry, ...state.entries.filter((o) => !sameNodes(o))].slice(
    0,
    MAX_ENTRIES,
  )
  setState({ entries, activeId: entry.id })
}

/** Re-activate a history entry - the next paste inserts this one. */
export function clipboardActivate(id: string): void {
  if (state.entries.some((entry) => entry.id === id)) {
    setState({ ...state, activeId: id })
  }
}

export function clipboardRemove(id: string): void {
  const entries = state.entries.filter((entry) => entry.id !== id)
  setState({
    entries,
    // Removing the active entry promotes the newest remaining one, so the
    // clipboard never sits non-empty but with nothing to paste.
    activeId: state.activeId === id ? (entries[0]?.id ?? null) : state.activeId,
  })
}

export function clipboardClear(): void {
  setState({ entries: [], activeId: null })
}
