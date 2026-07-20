import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CodeIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { plainEditorOption } from '@/features/inspector/inspectorSchema'
import { cn } from '@/lib/utils'
import type { PropertyEditorComponent, PropertyEditorProps } from './registry'
import { highlight, resolveHighlightMode } from './codeHighlight'

export const CODE_EDITOR = 'Neos.Neos/Inspector/Editors/CodeEditor'

/** The current value as a string; the editor only ever edits raw text. */
function asText(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
}

/**
 * A syntax-highlighted plain-text code area: a transparent <textarea> laid over
 * a <pre> that renders the same text with color spans, plus a line-number
 * gutter. Everything shares the identical monospace metrics so the caret and
 * highlighting stay aligned; the textarea drives scrolling and the other two
 * layers follow it. Lines are not wrapped (they scroll horizontally) so the
 * gutter maps one number per source line.
 */
function CodeArea({
  value,
  onChange,
  mode,
  autoFocus,
  readOnly,
}: {
  value: string
  onChange: (next: string) => void
  mode: 'markup' | 'code'
  autoFocus?: boolean
  readOnly?: boolean
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const preRef = useRef<HTMLPreElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)

  const html = useMemo(
    // A trailing newline needs a blank final line in the <pre> to match the
    // textarea's height, or the last row's highlight is clipped.
    () => highlight(value.endsWith('\n') ? value + ' ' : value, mode),
    [value, mode],
  )
  const lineCount = useMemo(() => value.split('\n').length, [value])

  // Keep the highlight layer and gutter locked to the textarea's scroll.
  const syncScroll = () => {
    const textarea = textareaRef.current
    if (!textarea) return
    if (preRef.current) {
      preRef.current.scrollTop = textarea.scrollTop
      preRef.current.scrollLeft = textarea.scrollLeft
    }
    if (gutterRef.current) gutterRef.current.scrollTop = textarea.scrollTop
  }

  // The textarea is created after `html`, so align on first paint.
  useLayoutEffect(syncScroll, [html])

  // Insert two spaces on Tab instead of leaving the field.
  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Tab' || readOnly) return
    event.preventDefault()
    const el = event.currentTarget
    const { selectionStart, selectionEnd } = el
    const next =
      value.slice(0, selectionStart) + '  ' + value.slice(selectionEnd)
    onChange(next)
    // Restore the caret after the inserted spaces once React re-renders.
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = selectionStart + 2
    })
  }

  const shared =
    'm-0 border-0 p-3 font-mono text-sm leading-5 whitespace-pre [tab-size:2]'

  return (
    <div className="relative h-[60vh] overflow-hidden rounded-md border border-neutral-700 bg-neutral-950 font-mono text-sm leading-5">
      <div className="flex h-full">
        <div
          ref={gutterRef}
          aria-hidden
          className="shrink-0 overflow-hidden border-r border-neutral-800 bg-neutral-900/60 py-3 pr-2 pl-3 text-right text-neutral-600 select-none"
        >
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
        <div className="relative flex-1">
          <pre
            ref={preRef}
            aria-hidden
            className={cn(shared, 'h-full overflow-auto text-neutral-200')}
          >
            <code dangerouslySetInnerHTML={{ __html: html }} />
          </pre>
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onScroll={syncScroll}
            onKeyDown={onKeyDown}
            autoFocus={autoFocus}
            readOnly={readOnly}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className={cn(
              shared,
              // Overlaid exactly on the <pre>; text is transparent so only the
              // highlighted layer shows, but the caret stays visible.
              'absolute inset-0 h-full w-full resize-none overflow-auto bg-transparent text-transparent caret-white outline-none',
            )}
          />
        </div>
      </div>
    </div>
  )
}

/**
 * Edits a property's raw textual content - HTML blocks and pure code - in a
 * modal dialog with syntax highlighting. The inspector shows a compact,
 * read-only preview of the current value; opening the dialog edits a local
 * draft that is committed on Apply (Cancel discards it), matching the classic
 * Neos CodeEditor's modal workflow.
 *
 * editorOptions: `highlightingMode` (a MIME type, e.g. "text/html") picks the
 * highlighter; `buttonLabel` overrides the open-button text; `disabled` /
 * `readonly` open the dialog read-only.
 */
export const CodeEditor: PropertyEditorComponent = ({
  subject,
  value,
  onCommit,
  onChange,
  options,
  autoFocus,
}: PropertyEditorProps) => {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')

  const mode = resolveHighlightMode(
    typeof options.highlightingMode === 'string'
      ? options.highlightingMode
      : undefined,
  )
  const readOnly = options.disabled === true || options.readonly === true
  const buttonLabel = plainEditorOption(options, 'buttonLabel') ?? 'Edit code…'

  const current = asText(value)
  const preview = useMemo(() => highlight(current, mode), [current, mode])

  const openDialog = () => {
    setDraft(current)
    setOpen(true)
  }

  const apply = () => {
    if (draft !== current) {
      onChange?.(draft)
      onCommit(draft)
    }
    setOpen(false)
  }

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        autoFocus={autoFocus}
        className="group flex w-full flex-col gap-2 rounded-md border border-neutral-700 bg-neutral-700/30 p-2 text-left transition-colors hover:border-neutral-600 focus-visible:border-blue-500 focus-visible:ring-[3px] focus-visible:ring-blue-500/50 focus-visible:outline-none"
      >
        {current ? (
          <pre className="max-h-24 overflow-hidden font-mono text-xs leading-5 whitespace-pre-wrap text-neutral-200">
            <code dangerouslySetInnerHTML={{ __html: preview }} />
          </pre>
        ) : (
          <span className="py-1 text-sm text-neutral-500">No content yet</span>
        )}
        <span className="flex items-center gap-1.5 text-xs font-medium text-neutral-400 group-hover:text-white">
          <CodeIcon className="size-3.5" />
          {buttonLabel}
        </span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CodeIcon className="size-4" />
              {subject.label}
            </DialogTitle>
          </DialogHeader>

          {open && (
            <CodeArea
              value={draft}
              onChange={setDraft}
              mode={mode}
              readOnly={readOnly}
              autoFocus
            />
          )}

          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={apply} disabled={readOnly}>
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
