import { useSyncExternalStore } from 'react'
import type { NodeDto } from '@/api/nodes'

/**
 * The node clipboard: cut/copied nodes waiting to be pasted, held in plain
 * client state (deliberately not persisted - a cut refers to live workspace
 * structure, and a reload starts a fresh editing session anyway).
 *
 * Entries are a history, newest first, with exactly one active entry - the
 * one a paste inserts. Cutting/copying activates the new entry; the Clipboard
 * panel re-activates older ones. Entries are kind-separated: a document can
 * only be pasted in the document tree, content only in the content outliner,
 * never mixed.
 */

/** Which tree an entry belongs to - paste is only offered for the same kind. */
export type ClipboardKind = 'document' | 'content'

export type ClipboardMode = 'copy' | 'cut'

export interface ClipboardEntry {
  /** Stable identity of the history entry (not of the node). */
  id: string
  mode: ClipboardMode
  kind: ClipboardKind
  /** Encoded address of the source node at cut/copy time. */
  address: string
  aggregateId: string
  nodeType: string
  /** Display snapshot from cut/copy time - not refreshed. */
  label: string
  /** The source's parent - its children list shrinks when a cut is pasted. */
  sourceParentAddress: string | null
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
 * Put a node on the clipboard and make it the active entry. An existing
 * entry for the same node is replaced (cutting a node you copied earlier
 * updates it rather than leaving both in the history).
 */
export function clipboardAdd(
  mode: ClipboardMode,
  kind: ClipboardKind,
  node: NodeDto,
  sourceParentAddress: string | null,
): void {
  const entry: ClipboardEntry = {
    id: crypto.randomUUID(),
    mode,
    kind,
    address: node.address,
    aggregateId: node.aggregateId,
    nodeType: node.nodeType,
    label: node.label !== '' ? node.label : node.aggregateId,
    sourceParentAddress,
  }
  const entries = [
    entry,
    ...state.entries.filter((other) => other.address !== node.address),
  ].slice(0, MAX_ENTRIES)
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
