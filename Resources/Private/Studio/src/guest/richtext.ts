/**
 * The rich-text engine behind Studio inline editing: a TipTap (ProseMirror)
 * editor mounted in place on every inline-editable property the edit-mode
 * markup emits ([data-__neos-property], from Neos.Neos:Editable). It replaces
 * the plain contentEditable the guest used before, giving structured,
 * schema-constrained editing that serializes back to clean HTML.
 *
 * Saving matches the classic Neos UI's cadence: a commit fires 1.5s after the
 * last keystroke, at least every 5s during continuous typing, and immediately
 * on blur - so work persists WHILE typing, not only after leaving the field.
 * Alongside commits, every change emits a throttled liveUpdate: the ephemeral
 * live-typing stream collaborators see (transport and fan-out are the host's
 * business; without the realtime sidecar the hook simply leads nowhere).
 *
 * The engine only owns the editor lifecycle (mount, debounced commit,
 * Escape-revert, empty-state for the placeholder, the collaboration lock
 * state). Node identity, the host bridge and the postMessage protocol stay in
 * main.ts, which fulfils the hooks by resolving the NodeAddress and posting
 * to the host.
 *
 * TipTap mounts by appending its own contenteditable (.tiptap) into the
 * property element, so `editor.getHTML()` returns the property value without
 * the host wrapper - exactly what Neos stores.
 */
import { Editor } from '@tiptap/core'
import {
  extensionsFor,
  parseFormatting,
  setEditorFormatting,
} from './formatting'
import { hideToolbars, updateToolbars } from './toolbar'

const PROPERTY_ATTRIBUTE = 'data-__neos-property'
const PLACEHOLDER_ATTRIBUTE = 'data-__neos-studio-placeholder'
const SHINE_THROUGH_ATTRIBUTE = 'data-__neos-studio-shine-through'
const EMPTY_CLASS = 'neos-studio-empty'

/** Commit cadence, mirroring Neos.Neos.Ui's CKEditor binding (1500/5000). */
const COMMIT_DEBOUNCE_MS = 1_500
const COMMIT_MAX_WAIT_MS = 5_000
/** Live-typing stream cadence - cosmetic, so generously throttled. */
const LIVE_UPDATE_THROTTLE_MS = 200

export interface RichTextHooks {
  /** Changed content should be persisted; html is getHTML(). Fired debounced
   * while typing and flushed on blur. */
  commit(element: HTMLElement, html: string): void
  /** The editor gained focus or its content changed - reposition chrome. */
  activity(): void
  /** Throttled while typing: the current content, for the live-typing stream. */
  liveUpdate?(element: HTMLElement, html: string): void
  /** The user started (true) / stopped (false) editing this property - the
   * basis of the collaboration edit lock. */
  editingState?(element: HTMLElement, editing: boolean): void
}

/**
 * Trailing debounce with a max-wait ceiling: the callback runs `wait` ms
 * after the last schedule(), but never later than `maxWait` ms after the
 * first unflushed one - so continuous typing still persists periodically.
 */
function debounceWithMaxWait(fn: () => void, wait: number, maxWait: number) {
  let timer: number | null = null
  let firstScheduledAt: number | null = null
  const run = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    firstScheduledAt = null
    fn()
  }
  return {
    schedule() {
      const now = Date.now()
      if (firstScheduledAt === null) firstScheduledAt = now
      if (timer !== null) clearTimeout(timer)
      const untilMaxWait = maxWait - (now - firstScheduledAt)
      timer = window.setTimeout(run, Math.max(0, Math.min(wait, untilMaxWait)))
    },
    /** Run now if anything is pending; no-op otherwise. */
    flush() {
      if (timer !== null) run()
    },
    cancel() {
      if (timer !== null) clearTimeout(timer)
      timer = null
      firstScheduledAt = null
    },
  }
}

/** Leading + trailing throttle: fires immediately, then at most once per
 * interval, and always ends with a trailing call carrying the final state. */
function throttle(fn: () => void, interval: number) {
  let last = 0
  let timer: number | null = null
  return () => {
    const now = Date.now()
    const remaining = interval - (now - last)
    if (remaining <= 0) {
      last = now
      fn()
    } else if (timer === null) {
      timer = window.setTimeout(() => {
        timer = null
        last = Date.now()
        fn()
      }, remaining)
    }
  }
}

/** Toggle the empty class that drives the CSS placeholder (::before). */
function refreshEmptyState(element: HTMLElement, editor: Editor): void {
  if (!element.hasAttribute(PLACEHOLDER_ATTRIBUTE)) return
  element.classList.toggle(EMPTY_CLASS, editor.isEmpty)
}

let stylesInjected = false

/**
 * Editing affordances the rendered site does not style: the cell borders that
 * keep an in-progress table legible, the selected-cell highlight and the
 * column-resize handle ProseMirror's table view draws. Scoped to the editor
 * (.tiptap inside a property) so the site's own table styling is untouched.
 */
function injectEditorStyles(): void {
  if (stylesInjected) return
  stylesInjected = true
  const style = document.createElement('style')
  style.textContent = `
    [${PROPERTY_ATTRIBUTE}] .tiptap .tableWrapper {
      overflow-x: auto;
    }
    [${PROPERTY_ATTRIBUTE}] .tiptap table {
      border-collapse: collapse;
      table-layout: fixed;
      width: 100%;
      margin: 0;
    }
    [${PROPERTY_ATTRIBUTE}] .tiptap :is(td, th) {
      position: relative;
      min-width: 2em;
      border: 1px solid rgba(0, 0, 0, 0.25);
      padding: 4px 6px;
      vertical-align: top;
    }
    [${PROPERTY_ATTRIBUTE}] .tiptap th {
      font-weight: 600;
      background: rgba(0, 0, 0, 0.04);
    }
    [${PROPERTY_ATTRIBUTE}] .tiptap .selectedCell::after {
      content: '';
      position: absolute;
      inset: 0;
      background: rgba(0, 173, 238, 0.15);
      pointer-events: none;
    }
    [${PROPERTY_ATTRIBUTE}] .tiptap .column-resize-handle {
      position: absolute;
      right: -2px;
      top: 0;
      bottom: -2px;
      width: 4px;
      background: rgb(0, 173, 238);
      pointer-events: none;
    }
    [${PROPERTY_ATTRIBUTE}] .tiptap.resize-cursor {
      cursor: col-resize;
    }
  `
  document.head.appendChild(style)
}

/**
 * A mounted property editor plus the operations the collaboration layer
 * needs on it: locking (a peer edits this text), applying their streamed
 * content, and flushing/cancelling the pending commit.
 */
interface ManagedEditor {
  editor: Editor
  /** A collaborator holds the edit lock: read-only while true. */
  setLocked(locked: boolean): void
  /** A peer's live-typing content; ignored while the local user is typing. */
  applyRemoteContent(html: string): void
  /**
   * The user lost the edit-lock arbitration while already typing: discard
   * the unpersisted keystrokes (revert to the committed state), cancel the
   * pending commit and leave the editor. The winner's content follows via
   * their live stream / the change feed.
   */
  eject(): void
}

const editorsByElement = new Map<HTMLElement, ManagedEditor>()

function mountEditor(element: HTMLElement, hooks: RichTextHooks): void {
  if (editorsByElement.has(element)) return
  // TipTap appends its own editable into the element without removing the
  // host-rendered markup, so we snapshot that markup as the initial content
  // and clear the element first - otherwise the original and the editor's
  // render coexist and the content visibly doubles.
  const initialContent = element.innerHTML
  element.replaceChildren()
  // The schema and toolbar are constrained to what the property's NodeType
  // declares (data-__neos-studio-formatting); a property without config gets
  // a permissive default.
  const config = parseFormatting(element)
  // The committed baseline, captured after TipTap normalizes the markup so a
  // commit without a real change never fires. setContent on Escape restores
  // exactly this string, so the pending commit becomes a no-op.
  let committedHtml = ''
  // True while applyRemoteContent() writes a peer's stream into the editor -
  // the resulting update event must not schedule a commit (their client
  // persists; ours would echo their content as our own edit).
  let applyingRemote = false

  const commitIfChanged = () => {
    const html = editor.getHTML()
    if (html === committedHtml) return
    committedHtml = html
    hooks.commit(element, html)
  }
  const commit = debounceWithMaxWait(
    commitIfChanged,
    COMMIT_DEBOUNCE_MS,
    COMMIT_MAX_WAIT_MS,
  )
  const emitLiveUpdate = throttle(() => {
    hooks.liveUpdate?.(element, editor.getHTML())
  }, LIVE_UPDATE_THROTTLE_MS)

  const editor = new Editor({
    element,
    content: initialContent,
    extensions: extensionsFor(config),
    editorProps: {
      // Neos node drags (from the element handle or the creation panel) must
      // never drop into a rich-text editor. Returning true (without
      // preventDefault) keeps the editor from becoming a drop target, so the
      // drag resolves against the enclosing content collection (main.ts's
      // drop machinery) instead. This also disables ProseMirror's own
      // internal drag-drop, which the Studio does not use.
      handleDOMEvents: {
        dragover: () => true,
        drop: () => true,
      },
      handleKeyDown: (_view, event) => {
        if (event.key === 'Escape') {
          // Revert to the last committed state. The setContent triggers an
          // update event that schedules a commit - which then diffs equal
          // and does nothing; peers' live view snaps back with the revert.
          editor.commands.setContent(committedHtml)
          editor.commands.blur()
          return true
        }
        return false
      },
    },
    onCreate: ({ editor }) => {
      committedHtml = editor.getHTML()
      refreshEmptyState(element, editor)
    },
    onFocus: ({ editor }) => {
      updateToolbars(editor)
      hooks.activity()
      hooks.editingState?.(element, true)
    },
    onSelectionUpdate: ({ editor }) => updateToolbars(editor),
    onUpdate: ({ editor }) => {
      refreshEmptyState(element, editor)
      updateToolbars(editor)
      hooks.activity()
      if (applyingRemote) return
      // Typing: persist debounced (1.5s pause / 5s ceiling) and stream the
      // current state to collaborators.
      commit.schedule()
      emitLiveUpdate()
    },
    onBlur: ({ editor }) => {
      hideToolbars()
      refreshEmptyState(element, editor)
      // Leaving the field commits whatever the debounce still holds.
      commit.flush()
      commitIfChanged()
      hooks.editingState?.(element, false)
    },
    onDestroy: () => {
      commit.cancel()
    },
  })
  setEditorFormatting(editor, config)
  editorsByElement.set(element, {
    editor,
    setLocked(locked) {
      // No update event: the lock changes editability, not content.
      editor.setEditable(!locked, false)
    },
    applyRemoteContent(html) {
      // Never write under the local user's caret. Normally excluded by the
      // lock itself; this guards the race before the lock arrived.
      if (editor.isFocused) return
      applyingRemote = true
      try {
        editor.commands.setContent(html)
      } finally {
        applyingRemote = false
      }
      // The stream shows what the peer will commit - adopt it as the
      // baseline so a later local edit diffs against current reality.
      committedHtml = editor.getHTML()
      refreshEmptyState(element, editor)
    },
    eject() {
      // Order matters: cancel first, then revert (the setContent-triggered
      // update re-schedules a commit, which later diffs equal and no-ops),
      // then blur (whose flush also diffs equal). The losing keystrokes are
      // NEVER persisted - persisting them would clobber the winner's text.
      commit.cancel()
      editor.commands.setContent(committedHtml)
      editor.commands.blur()
    },
  })
}

/**
 * Mount an editor on every inline-editable property under `root` - except
 * inside shine-through elements (existing here only via dimension fallback):
 * those are read-only until the editor explicitly creates the variant (the
 * "Create variant" button); an implicit variant-on-edit would be too subtle
 * for a consequence of that weight.
 */
export function mountRichTextEditors(
  root: ParentNode,
  hooks: RichTextHooks,
): void {
  injectEditorStyles()
  for (const element of root.querySelectorAll<HTMLElement>(
    `[${PROPERTY_ATTRIBUTE}]`,
  )) {
    if (element.closest(`[${SHINE_THROUGH_ATTRIBUTE}]`)) continue
    mountEditor(element, hooks)
  }
}

/** Lock/unlock a property editor (a collaborator is editing this text). */
export function setPropertyLocked(element: HTMLElement, locked: boolean): void {
  editorsByElement.get(element)?.setLocked(locked)
}

/** Apply a collaborator's live-typing content to a property editor. */
export function applyRemotePropertyContent(
  element: HTMLElement,
  html: string,
): void {
  editorsByElement.get(element)?.applyRemoteContent(html)
}

/** Kick the user out of a property editor after a lost lock arbitration:
 * discards unpersisted keystrokes and blurs. */
export function ejectFromProperty(element: HTMLElement): void {
  editorsByElement.get(element)?.eject()
}
