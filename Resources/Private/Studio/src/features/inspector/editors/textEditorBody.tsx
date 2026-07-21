import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { plainEditorOption } from '@/features/inspector/inspectorSchema'
import type { PropertyEditorProps } from './registry'

/**
 * The shared implementation behind the single-line and multi-line text
 * editors. Holds the draft locally, reports every keystroke through onChange,
 * and commits on blur (or Enter, in the single-line variant); Escape reverts
 * the draft. Doubles as the number editor for integer/float properties - an
 * empty field clears the value, a non-number is refused and reverts on commit.
 */
export function TextEditorBody({
  multiline,
  subject,
  value,
  onCommit,
  onChange,
  options,
  autoFocus,
  invalid,
}: PropertyEditorProps & { multiline: boolean }) {
  const initial = value === null || value === undefined ? '' : String(value)
  const [draft, setDraft] = useState(initial)
  const placeholder = plainEditorOption(options, 'placeholder')
  const isNumeric = subject.type === 'integer' || subject.type === 'float'

  // The outgoing value for a raw input string: the string itself, or a parsed
  // number (null when empty) for numeric properties. `ok` is false only for a
  // non-numeric entry in a numeric field.
  const parse = (raw: string): { ok: boolean; value: unknown } => {
    if (!isNumeric) return { ok: true, value: raw }
    const parsed = raw.trim() === '' ? null : Number(raw)
    if (parsed !== null && Number.isNaN(parsed))
      return { ok: false, value: null }
    return { ok: true, value: parsed }
  }

  const change = (raw: string) => {
    setDraft(raw)
    const { ok, value: outgoing } = parse(raw)
    // Skip live reporting of an in-progress non-number; commit will revert it.
    if (ok) onChange?.(outgoing)
  }

  const commit = () => {
    if (draft === initial) return
    const { ok, value: outgoing } = parse(draft)
    if (!ok) {
      setDraft(initial)
      return
    }
    onCommit(outgoing)
  }

  const keyHandlers = {
    onKeyDown: (
      event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      if (event.key === 'Escape') {
        // preventDefault keeps any surrounding dialog/panel open - Escape here
        // only cancels the draft.
        event.preventDefault()
        setDraft(initial)
        onChange?.(parse(initial).value)
        event.currentTarget.blur()
      }
      // Enter commits via blur, but must keep inserting newlines in textareas.
      if (
        event.key === 'Enter' &&
        event.currentTarget instanceof HTMLInputElement
      ) {
        event.currentTarget.blur()
      }
    },
    onBlur: commit,
  }

  if (multiline) {
    return (
      <Textarea
        autoFocus={autoFocus}
        value={draft}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        onChange={(event) => change(event.target.value)}
        {...keyHandlers}
      />
    )
  }
  return (
    <Input
      autoFocus={autoFocus}
      value={draft}
      placeholder={placeholder}
      aria-invalid={invalid || undefined}
      inputMode={isNumeric ? 'decimal' : undefined}
      onChange={(event) => change(event.target.value)}
      {...keyHandlers}
    />
  )
}
