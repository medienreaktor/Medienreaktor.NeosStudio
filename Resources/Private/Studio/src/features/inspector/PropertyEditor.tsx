import { useState } from 'react'
import type { SerializedPropertyValue } from '@/api/nodes'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { FaIcon } from '@/features/tree/nodeTypeIcon'
import { sortByPosition } from '@/lib/positional'
import { humanizeLabel, plainEditorOption, type InspectorProperty } from './inspectorSchema'

const TEXT_FIELD_EDITOR = 'Neos.Neos/Inspector/Editors/TextFieldEditor'
const TEXT_AREA_EDITOR = 'Neos.Neos/Inspector/Editors/TextAreaEditor'
// A text field with a sync button in the classic UI - plain text for now.
const URI_PATH_SEGMENT_EDITOR = 'Neos.Neos/Inspector/Editors/UriPathSegmentEditor'
const SELECT_BOX_EDITOR = 'Neos.Neos/Inspector/Editors/SelectBoxEditor'

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
    case SELECT_BOX_EDITOR:
      return <SelectEditor property={property} value={value} onSave={onSave} />
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
        // preventDefault keeps the inspector panel open - Escape here only
        // cancels the draft.
        event.preventDefault()
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

/** One selectable option from editorOptions.values. */
interface SelectBoxValueConfig {
  label?: string | null
  icon?: string | null
  position?: string | number
}

/**
 * The SelectBoxEditor: a dropdown over the statically configured
 * editorOptions.values - single-select for scalar properties, multi-select
 * (editorOptions.multiple, the default for array properties) with the
 * selection summarized in the trigger. Data sources (searchOnServer,
 * dataSourceIdentifier) are not supported yet and fall back to an empty
 * option list.
 */
function SelectEditor({
  property,
  value,
  onSave,
}: {
  property: InspectorProperty
  value: SerializedPropertyValue | undefined
  onSave: (propertyName: string, value: unknown) => void
}) {
  const valuesConfig = (property.editorOptions.values ?? {}) as Record<string, SelectBoxValueConfig | null>
  const multiple = property.editorOptions.multiple === true
  const allowEmpty = property.editorOptions.allowEmpty === true
  const placeholder = plainEditorOption(property.editorOptions, 'placeholder') ?? '–'

  const options = sortByPosition(
    Object.entries(valuesConfig).map(([key, config]) => ({ key, position: config?.position })),
  ).map((key) => ({
    value: key,
    label: humanizeLabel(valuesConfig[key]?.label, key),
    icon: valuesConfig[key]?.icon ?? null,
  }))
  const labelFor = (key: string) => options.find((option) => option.value === key)?.label ?? key

  // Draft state so the dropdown reflects a save instantly, without waiting
  // for the node refetch (the mount key resets it per node + property).
  const [selected, setSelected] = useState<string | string[] | null>(() => {
    if (multiple) {
      return Array.isArray(value?.value) ? value.value.filter((v): v is string => typeof v === 'string') : []
    }
    return typeof value?.value === 'string' && value.value !== '' ? value.value : null
  })

  const items = (
    <SelectContent>
      {/* A null item both renders the placeholder in the trigger and lets
          the user clear the value. */}
      {!multiple && allowEmpty && (
        <SelectItem value={null}>
          <span className="text-muted-foreground">{placeholder}</span>
        </SelectItem>
      )}
      {options.map((option) => (
        <SelectItem key={option.value} value={option.value}>
          {option.icon && <FaIcon icon={option.icon} />}
          {option.label}
        </SelectItem>
      ))}
    </SelectContent>
  )

  if (multiple) {
    return (
      <Select
        multiple
        value={selected as string[]}
        onValueChange={(next) => {
          const values = next as string[]
          setSelected(values)
          onSave(property.name, values)
        }}
      >
        <SelectTrigger className="w-full">
          <SelectValue>
            {(current: string[]) =>
              current.length > 0 ? (
                current.map(labelFor).join(', ')
              ) : (
                <span className="text-muted-foreground">{placeholder}</span>
              )
            }
          </SelectValue>
        </SelectTrigger>
        {items}
      </Select>
    )
  }

  return (
    <Select
      value={selected as string | null}
      onValueChange={(next) => {
        const selectedValue = next as string | null
        setSelected(selectedValue)
        // null unsets the property - matches allowEmpty semantics.
        onSave(property.name, selectedValue)
      }}
    >
      <SelectTrigger className="w-full">
        <SelectValue>
          {(current: string | null) =>
            current !== null ? labelFor(current) : <span className="text-muted-foreground">{placeholder}</span>
          }
        </SelectValue>
      </SelectTrigger>
      {items}
    </Select>
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
