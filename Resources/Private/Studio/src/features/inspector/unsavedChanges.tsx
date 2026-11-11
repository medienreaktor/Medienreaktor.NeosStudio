import { useEffect, useRef, useSyncExternalStore } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { translate as t } from '@/lib/i18n'

/**
 * Unsaved inspector input. The text editors save explicitly (Enter, the
 * inline apply button - see DraftField), so a draft can still be pending when
 * the selection moves on - which remounts the inspector and would silently
 * drop it. Every dirty editor registers here (useUnsavedDraft); the shell
 * routes each selection change through guardNavigation(), which asks first
 * while anything is pending: save it all, discard it all, or stay.
 */
interface UnsavedDraft {
  /** The property label, listed in the dialog. */
  label: string
  /** Commit the draft (the editor's apply). */
  apply: () => void
  /** Throw the draft away (the editor's revert). */
  discard: () => void
}

const drafts = new Map<symbol, UnsavedDraft>()
/** The navigation waiting for the user's answer, or null. */
let pending: (() => void) | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((listener) => listener())
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Whether any editor holds an unsaved draft. */
export function hasUnsavedDrafts(): boolean {
  return drafts.size > 0
}

/**
 * Runs `navigate` right away when nothing is unsaved; otherwise asks first
 * and runs it once the drafts are saved or discarded - or never, when the
 * user stays. A second navigation while asking replaces the first.
 */
export function guardNavigation(navigate: () => void): void {
  if (drafts.size === 0) {
    navigate()
    return
  }
  pending = navigate
  notify()
}

/**
 * Registers the calling editor's draft while `dirty`. The callbacks may
 * change identity on every render - the latest ones are used.
 */
export function useUnsavedDraft(
  dirty: boolean,
  draft: UnsavedDraft | null,
): void {
  const latest = useRef(draft)
  useEffect(() => {
    latest.current = draft
  })
  const enabled = dirty && draft !== null
  useEffect(() => {
    if (!enabled) return
    const key = Symbol('unsaved-draft')
    drafts.set(key, {
      get label() {
        return latest.current?.label ?? ''
      },
      apply: () => latest.current?.apply(),
      discard: () => latest.current?.discard(),
    })
    return () => {
      drafts.delete(key)
    }
  }, [enabled])
}

function resolve(action: 'save' | 'discard' | 'stay') {
  const navigate = pending
  pending = null
  if (action !== 'stay') {
    for (const draft of [...drafts.values()]) {
      if (action === 'save') draft.apply()
      else draft.discard()
    }
    navigate?.()
  }
  notify()
}

/**
 * The "unsaved changes" dialog - rendered once by the shell. Also warns on
 * leaving the page (reload, closing the tab) while a draft is pending.
 */
export function UnsavedChangesDialog() {
  const open = useSyncExternalStore(subscribe, () => pending !== null)

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (drafts.size === 0) return
      event.preventDefault()
      // Older browsers need returnValue set to show the prompt.
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  const labels = open
    ? [...new Set([...drafts.values()].map((draft) => draft.label))]
    : []

  return (
    <UnsavedChangesPrompt
      open={open}
      labels={labels}
      onSave={() => resolve('save')}
      onDiscard={() => resolve('discard')}
      onStay={() => resolve('stay')}
    />
  )
}

/**
 * The "unsaved changes" question itself, for any surface with explicitly
 * saved fields (the inspector's guard above, the asset details dialog):
 * lists the fields, then keep editing / discard / save.
 */
export function UnsavedChangesPrompt({
  open,
  labels,
  saveLabel = t('inspector.unsaved.save', 'Save and continue'),
  busy = false,
  onSave,
  onDiscard,
  onStay,
}: {
  open: boolean
  /** The labels of the fields with unsaved input. */
  labels: string[]
  saveLabel?: string
  /** While true (a save in flight), the buttons are disabled. */
  busy?: boolean
  onSave: () => void
  onDiscard: () => void
  onStay: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onStay()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('inspector.unsaved.title', 'Unsaved changes')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'inspector.unsaved.description',
              'Some fields have changes that are not saved yet. Save them before you continue?',
            )}
          </DialogDescription>
        </DialogHeader>
        {labels.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-5 type-body">
            {labels.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        )}
        <DialogFooter className="sm:justify-between">
          <Button variant="secondary" disabled={busy} onClick={onStay}>
            {t('inspector.unsaved.stay', 'Keep editing')}
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="destructive" disabled={busy} onClick={onDiscard}>
              {t('inspector.unsaved.discard', 'Discard')}
            </Button>
            <Button disabled={busy} onClick={onSave}>
              {saveLabel}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
