import { useState } from 'react'
import { DraftField, isApplyChord } from '@/components/ui/draft-field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { plainEditorOption } from '@/features/inspector/inspectorSchema'
import { useUnsavedDraft } from '@/features/inspector/unsavedChanges'
import type { PropertyEditorProps } from './registry'

/**
 * The shared implementation behind the single-line and multi-line text
 * editors. Holds the draft locally, reports every keystroke through onChange,
 * and commits explicitly: Enter in the single-line variant, mod+Enter in the
 * multi-line one, or the inline apply button; Escape or the revert button
 * throws the draft away (see DraftField). Leaving the field does NOT commit -
 * the buttons stay visible while the draft is unsaved.
 * Doubles as the number editor for integer/float properties - an empty field
 * clears the value, a non-number is refused and reverts on commit.
 *
 * The draft follows the incoming value while there is no unsaved edit (a save
 * from elsewhere, a collaborator's change, the refetch after the own commit),
 * and a commit only fires when the draft differs from the value the edit
 * started from.
 *
 * In the creation dialog (no nodeAddress) the buttons are left out: the
 * dialog takes every keystroke through onChange, there is nothing to apply.
 */
export function TextEditorBody({
  multiline,
  id,
  subject,
  value,
  onCommit,
  onChange,
  options,
  nodeAddress,
  autoFocus,
  invalid,
}: PropertyEditorProps & { multiline: boolean }) {
  const initial = value === null || value === undefined ? '' : String(value)
  const [draft, setDraft] = useState(initial)
  // The value the current draft started from.
  const [base, setBase] = useState(initial)
  if (initial !== base && (draft === base || draft === initial)) {
    setBase(initial)
    setDraft(initial)
  }
  // The draft last handed to onCommit - not dirty any more, though the base
  // only catches up once the saved value comes back.
  const [submitted, setSubmitted] = useState<string | null>(null)
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

  const dirty = draft !== base && draft !== submitted

  const commit = () => {
    if (!dirty) return
    const { ok, value: outgoing } = parse(draft)
    if (!ok) {
      revert()
      return
    }
    setSubmitted(draft)
    onCommit(outgoing)
  }

  const revert = () => {
    setBase(initial)
    setDraft(initial)
    setSubmitted(null)
    onChange?.(parse(initial).value)
  }

  // Pending input guards the selection change that would drop it.
  useUnsavedDraft(
    dirty,
    nodeAddress !== undefined
      ? { label: subject.label, apply: commit, discard: revert }
      : null,
  )

  const fieldProps = {
    id,
    autoFocus,
    value: draft,
    placeholder,
    'aria-invalid': invalid || undefined,
    'data-draft-target': '',
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => change(event.target.value),
    onKeyDown: (
      event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      if (event.key === 'Escape') {
        // preventDefault keeps any surrounding dialog/panel open - Escape here
        // only cancels the draft.
        event.preventDefault()
        revert()
      }
      // Enter commits, but must keep inserting newlines in textareas - there
      // mod+Enter commits (without the newline). A single-line Enter keeps
      // its default, so it still submits a surrounding form (the creation
      // dialog).
      if (event.key === 'Enter' && !multiline) commit()
      if (multiline && isApplyChord(event)) {
        event.preventDefault()
        commit()
      }
    },
  }

  return (
    <DraftField
      dirty={dirty}
      placement={multiline ? 'bottom' : 'inline'}
      actions={nodeAddress !== undefined}
      onApply={commit}
      onRevert={revert}
    >
      {multiline ? (
        <Textarea {...fieldProps} />
      ) : (
        <Input {...fieldProps} inputMode={isNumeric ? 'decimal' : undefined} />
      )}
    </DraftField>
  )
}
