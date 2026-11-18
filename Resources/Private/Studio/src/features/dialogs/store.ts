import type * as React from 'react'

/** What a component opened with `dialogs.open()` gets besides its own props. */
export interface DialogControls<Result = unknown> {
  /**
   * Close the dialog. `result` resolves the opener's `result` promise;
   * without one (and on Escape, an outside click or the close button) it
   * resolves with undefined.
   */
  close: (result?: Result) => void
}

/** What `dialogs.open()` returns to the opener. */
export interface DialogHandle<Result = unknown> extends DialogControls<Result> {
  /**
   * Settles once the dialog closes: with the value it closed with, or
   * undefined when it was dismissed. Never rejects.
   */
  result: Promise<Result | undefined>
}

// `any` is what lets a component with props of its own be passed at all:
// component types are contravariant in their props.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DialogComponent = React.ComponentType<any>

/** The props `open` takes for a component: its own, without `close`. */
export type DialogPropsOf<C extends DialogComponent> = Omit<
  React.ComponentProps<C>,
  'close'
>

/** The value a component's `close` takes. */
export type DialogResultOf<C extends DialogComponent> =
  React.ComponentProps<C> extends {
    close: (result?: infer Result) => void
  }
    ? Result
    : unknown

export interface DialogEntry {
  id: number
  /** The dialog it was opened on - its root in the host; null at the bottom. */
  parentId: number | null
  /** Names the dialog in the error boundary's fallback and log. */
  name: string
  component: DialogComponent
  props: object
  /** False once closed, while the exit transition runs. */
  open: boolean
  close: (result?: unknown) => void
  /** Settles the opener's `result`. */
  resolve: (result: unknown) => void
}

let entries: DialogEntry[] = []
let nextId = 0
const listeners = new Set<() => void>()

function setEntries(next: DialogEntry[]): void {
  entries = next
  listeners.forEach((listener) => listener())
}

export function subscribeDialogs(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The dialogs in opening order - the last one is on top. */
export function dialogEntries(): DialogEntry[] {
  return entries
}

export function anyDialogOpen(): boolean {
  return entries.some((entry) => entry.open)
}

/**
 * Open a component as a dialog in the shell's dialog host (see
 * DialogHost). A dialog opened while others are open stacks on top of them.
 */
export function openDialog<C extends DialogComponent>(
  component: C,
  props?: DialogPropsOf<C>,
): DialogHandle<DialogResultOf<C>> {
  const id = ++nextId
  let resolve!: (result: unknown) => void
  const result = new Promise<DialogResultOf<C> | undefined>((done) => {
    resolve = done as (result: unknown) => void
  })
  const close = (value?: unknown) => closeDialog(id, value)
  const entry: DialogEntry = {
    id,
    parentId: entries.filter((other) => other.open).at(-1)?.id ?? null,
    name: component.displayName || component.name || 'anonymous',
    component,
    props: props ?? {},
    open: true,
    close,
    resolve,
  }
  setEntries([...entries, entry])
  return { close, result }
}

/**
 * The dialog and every dialog stacked on it, directly or not. Parents come
 * before their children in `entries`, so one pass finds them all.
 */
function withStacked(id: number): Set<number> {
  const ids = new Set([id])
  for (const entry of entries)
    if (entry.parentId !== null && ids.has(entry.parentId)) ids.add(entry.id)
  return ids
}

/**
 * Close a dialog and the dialogs stacked on it - they are its children in
 * the host and go with it. The ones above resolve as dismissed.
 */
function closeDialog(id: number, result: unknown): void {
  if (!entries.some((entry) => entry.id === id && entry.open)) return
  const closing = withStacked(id)
  setEntries(
    entries.map((entry) => {
      if (!closing.has(entry.id) || !entry.open) return entry
      entry.resolve(entry.id === id ? result : undefined)
      return { ...entry, open: false }
    }),
  )
}

/** Forget a closed dialog, with the ones on it, once its exit transition has finished. */
export function removeDialog(id: number): void {
  if (!entries.some((entry) => entry.id === id && !entry.open)) return
  const removed = withStacked(id)
  setEntries(entries.filter((entry) => !removed.has(entry.id)))
}
