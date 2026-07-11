import { useState } from 'react'
import type { SerializedPropertyValue } from '@/api/nodes'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { plainEditorOption, type InspectorProperty } from './inspectorSchema'

const TEXT_FIELD_EDITOR = 'Neos.Neos/Inspector/Editors/TextFieldEditor'
const TEXT_AREA_EDITOR = 'Neos.Neos/Inspector/Editors/TextAreaEditor'
// A text field with a sync button in the classic UI - plain text for now.
const URI_PATH_SEGMENT_EDITOR = 'Neos.Neos/Inspector/Editors/UriPathSegmentEditor'

/**
 * One property in the inspector: an editable control for the editors Studio
 * implements so far (text field, text area), a read-only value for everything
 * else. Mount with a key of node address + property name - the draft state
 * must reset when the edited subject changes, but survive the node refetch
 * after a save.
 */
export function PropertyEditor({
  property,
  value,
  onSave,
}: {
  property: InspectorProperty
  value: SerializedPropertyValue | undefined
  onSave: (propertyName: string, value: unknown) => void
}) {
  switch (property.editor) {
    case TEXT_FIELD_EDITOR:
    case TEXT_AREA_EDITOR:
    case URI_PATH_SEGMENT_EDITOR:
      return <TextEditor property={property} value={value} onSave={onSave} />
    default:
      return <ReadOnlyValue property={property} value={value} />
  }
}

function TextEditor({
  property,
  value,
  onSave,
}: {
  property: InspectorProperty
  value: SerializedPropertyValue | undefined
  onSave: (propertyName: string, value: unknown) => void
}) {
  const initial = value?.value === null || value?.value === undefined ? '' : String(value.value)
  const [draft, setDraft] = useState(initial)
  const placeholder = plainEditorOption(property.editorOptions, 'placeholder')
  const isNumeric = property.type === 'integer' || property.type === 'float'

  const commit = () => {
    if (draft === initial) return
    if (isNumeric) {
      // TextFieldEditor doubles as the number editor; empty clears the value.
      const parsed = draft.trim() === '' ? null : Number(draft)
      if (parsed !== null && Number.isNaN(parsed)) {
        setDraft(initial)
        return
      }
      onSave(property.name, parsed)
    } else {
      onSave(property.name, draft)
    }
  }

  const keyHandlers = {
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (event.key === 'Escape') {
        setDraft(initial)
        event.currentTarget.blur()
      }
      // Enter commits via blur, but must keep inserting newlines in textareas.
      if (event.key === 'Enter' && event.currentTarget instanceof HTMLInputElement) {
        event.currentTarget.blur()
      }
    },
    onBlur: commit,
  }

  if (property.editor === TEXT_AREA_EDITOR) {
    return (
      <Textarea
        value={draft}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        {...keyHandlers}
      />
    )
  }
  return (
    <Input
      value={draft}
      placeholder={placeholder}
      inputMode={isNumeric ? 'decimal' : undefined}
      onChange={(event) => setDraft(event.target.value)}
      {...keyHandlers}
    />
  )
}

/** Properties whose editor is not implemented yet - read out, not editable. */
function ReadOnlyValue({
  property,
  value,
}: {
  property: InspectorProperty
  value: SerializedPropertyValue | undefined
}) {
  return (
    <div
      className="min-h-9 rounded-md border border-dashed border-input px-3 py-2 text-sm wrap-break-word whitespace-pre-wrap text-muted-foreground"
      title={`Editor not supported yet: ${property.editor ?? property.type}`}
    >
      {formatValue(value)}
    </div>
  )
}

function formatValue(value: SerializedPropertyValue | undefined): string {
  const raw = value?.value
  if (raw === null || raw === undefined || raw === '') return '–'
  if (typeof raw === 'string') return raw
  if (typeof raw === 'boolean') return raw ? 'Yes' : 'No'
  if (typeof raw === 'number') return String(raw)
  return JSON.stringify(raw)
}
