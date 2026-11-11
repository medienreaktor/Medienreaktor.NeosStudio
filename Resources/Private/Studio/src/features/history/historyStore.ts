import { useSyncExternalStore } from 'react'
import { ApiError } from '@/api/http/errors'
import { studioEvents, type WorkspaceRef } from '@/app/events'
import type { HistoryLocation, Located } from './location'

/**
 * Undo/redo of this editor's own edits: a client-side history per workspace,
 * held in plain state like the clipboard (a reload starts a fresh editing
 * session). The write paths record an entry after each edit that reached the
 * server - properties and references (persistProperty), hide/show, delete
 * and move (nodeActions), creation (createNode) and pasted copies (paste) -
 * with the inverse operation and the redo built in. Undo/redo run those
 * through the same write paths, without recording them again.
 *
 * A workspace's history ends where its content stream does: publishing,
 * discarding or rebasing it (here or by a collaborator, as the change feed
 * reports it) clears it. Edits of collaborators in between are not undone:
 * an undo whose node was changed since fails (UndoConflictError, or the
 * server's 404/409/422) and is dropped from the history.
 *
 * An undo is a new write, not a discard: the content repository keeps
 * events, so an undone edit still counts as a pending change (a node moved
 * back is "moved", an undone creation "new" and "removed") until the
 * workspace's changes are published or discarded.
 */

export interface HistoryEntry {
  /** The workspace the edit was made in - undo/redo writes there too. */
  workspace: WorkspaceRef
  /** What the edit did, e.g. "Delete “Teaser”" - translated when shown. */
  label: () => string
  undo: () => Promise<void>
  redo: () => Promise<void>
  /**
   * Where the result of the undo / of the redo is seen (see locate) - the
   * shell goes there afterwards. Resolved in the background.
   */
  where: { undo: Located; redo: Located }
}

/** An undo or redo that would overwrite something changed since. */
export class UndoConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UndoConflictError'
  }
}

interface Stacks {
  undo: HistoryEntry[]
  /** Most recently undone last. */
  redo: HistoryEntry[]
}

/** Per workspace - older entries fall off. */
const MAX_ENTRIES = 100

const stacksByWorkspace = new Map<string, Stacks>()
/** When each entry was recorded (or last merged into). */
const recordedAt = new WeakMap<HistoryEntry, number>()
/** Counts changes of a workspace's history (record, clear) - see run(). */
const generations = new Map<string, number>()
let running = false
let version = 0
const listeners = new Set<() => void>()

function workspaceKey(workspace: WorkspaceRef): string {
  return JSON.stringify([
    workspace.contentRepositoryId,
    workspace.workspaceName,
  ])
}

function stacksOf(key: string): Stacks {
  let stacks = stacksByWorkspace.get(key)
  if (!stacks) {
    stacks = { undo: [], redo: [] }
    stacksByWorkspace.set(key, stacks)
  }
  return stacks
}

function bump(key: string): void {
  generations.set(key, (generations.get(key) ?? 0) + 1)
}

function notify(): void {
  version++
  listeners.forEach((listener) => listener())
}

/** Something shown about the entries changed (a location resolved). */
export function historyChanged(): void {
  notify()
}

export interface RecordOptions {
  /**
   * Merges the new entry with the newest one of the workspace (typing
   * bursts: one entry per edited text, not per save): returns the entry
   * replacing both, or null to keep them apart.
   */
  mergeWith?: (newest: HistoryEntry, recordedAt: number) => HistoryEntry | null
}

/** Records an edit; a new edit ends what could be redone. */
export function recordHistory(
  entry: HistoryEntry,
  options: RecordOptions = {},
): void {
  const key = workspaceKey(entry.workspace)
  const stacks = stacksOf(key)
  const newest = stacks.undo.at(-1)
  const merged =
    newest && options.mergeWith
      ? options.mergeWith(newest, recordedAt.get(newest) ?? 0)
      : null
  if (merged) stacks.undo.pop()
  const recorded = merged ?? entry
  recordedAt.set(recorded, Date.now())
  stacks.undo.push(recorded)
  if (stacks.undo.length > MAX_ENTRIES) stacks.undo.shift()
  stacks.redo = []
  bump(key)
  notify()
}

/** Forgets a workspace's history - its content stream was rewritten. */
export function clearHistory(workspace: WorkspaceRef): void {
  const key = workspaceKey(workspace)
  if (!stacksByWorkspace.delete(key)) return
  bump(key)
  notify()
}

/**
 * Errors that won't go away by trying again: the node is gone, changed in a
 * way the inverse no longer fits, or may not be changed. The entry is
 * dropped then; anything else (the network) keeps it for another try.
 */
function isPermanentFailure(error: unknown): boolean {
  return (
    error instanceof UndoConflictError ||
    (error instanceof ApiError && [403, 404, 409, 422].includes(error.status))
  )
}

/**
 * Undoes (or redoes) the newest entry of the workspace and moves it to the
 * other stack. One at a time across workspaces. Rejects with the write's
 * error - a permanent failure drops the entry, so the next undo goes on with
 * the one before it. If the workspace's history changed while the write ran
 * (a new edit, a publish), the entry is not moved to the other stack: a new
 * edit ends redo, a publish ends the history.
 */
async function run(
  workspace: WorkspaceRef,
  direction: 'undo' | 'redo',
): Promise<HistoryLocation | null> {
  if (running) return null
  const key = workspaceKey(workspace)
  const stacks = stacksOf(key)
  const from = direction === 'undo' ? stacks.undo : stacks.redo
  const entry = from.at(-1)
  if (!entry) return null
  const generation = generations.get(key) ?? 0
  running = true
  notify()
  try {
    await (direction === 'undo' ? entry.undo() : entry.redo())
    const current = stacksByWorkspace.get(key)
    if (current && (generations.get(key) ?? 0) === generation) {
      const source = direction === 'undo' ? current.undo : current.redo
      const target = direction === 'undo' ? current.redo : current.undo
      source.splice(source.indexOf(entry), 1)
      target.push(entry)
    }
    return entry.where[direction].current
  } catch (error) {
    if (isPermanentFailure(error)) {
      const current = stacksByWorkspace.get(key)
      const source = direction === 'undo' ? current?.undo : current?.redo
      const index = source?.indexOf(entry) ?? -1
      if (index >= 0) source?.splice(index, 1)
    }
    throw error
  } finally {
    running = false
    notify()
  }
}

/** Undoes the newest edit; resolves with where its result is seen. */
export function undo(workspace: WorkspaceRef): Promise<HistoryLocation | null> {
  return run(workspace, 'undo')
}

/** Redoes the newest undone edit; resolves with where it is seen. */
export function redo(workspace: WorkspaceRef): Promise<HistoryLocation | null> {
  return run(workspace, 'redo')
}

export interface HistoryState {
  /** The edit an undo would revert, null if there is none. */
  undoLabel: string | null
  /** Where an undo's result would be seen, null if unknown (yet). */
  undoLocation: HistoryLocation | null
  /** The undone edit a redo would apply again, null if there is none. */
  redoLabel: string | null
  redoLocation: HistoryLocation | null
  /** An undo or redo is running. */
  running: boolean
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The history of the workspace being edited, for the header's buttons. */
export function useHistory(workspace: WorkspaceRef | null): HistoryState {
  // The version changes with every record/undo/clear - the labels are
  // derived below, during render, so they follow the interface language.
  useSyncExternalStore(subscribe, () => version)
  const stacks = workspace
    ? stacksByWorkspace.get(workspaceKey(workspace))
    : undefined
  const undoEntry = stacks?.undo.at(-1)
  const redoEntry = stacks?.redo.at(-1)
  return {
    undoLabel: undoEntry?.label() ?? null,
    undoLocation: undoEntry?.where.undo.current ?? null,
    redoLabel: redoEntry?.label() ?? null,
    redoLocation: redoEntry?.where.redo.current ?? null,
    running,
  }
}

// What ends a workspace's history: its content stream was replaced.
studioEvents.on('workspace.published', clearHistory)
studioEvents.on('workspace.discarded', clearHistory)
studioEvents.on('workspace.rebased', clearHistory)
studioEvents.on('remote.changed', (change) => {
  if (change.kind === 'wholesale') clearHistory(change)
})
