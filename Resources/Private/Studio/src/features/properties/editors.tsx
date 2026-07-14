import { useState } from 'react'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  humanizeLabel,
  plainEditorOption,
} from '@/features/inspector/inspectorSchema'
import { FaIcon } from '@/features/tree/nodeTypeIcon'
import { sortByPosition } from '@/lib/positional'
import {
  type PropertyEditorComponent,
  type PropertyEditorProps,
  propertyEditorRegistry,
} from './registry'

/**
 * Studio's built-in property editors, each conforming to the shared editor
 * contract (see registry.ts) so the same component serves both the inspector
 * and the node creation dialogs. Registered under the Neos editor identifiers
 * that node type configuration references. Ported from the earlier
 * inspector-only and creation-only implementations, now unified.
 */

export const TEXT_FIELD_EDITOR = 'Neos.Neos/Inspector/Editors/TextFieldEditor'
export const TEXT_AREA_EDITOR = 'Neos.Neos/Inspector/Editors/TextAreaEditor'
// A text field with a "sync from title" button in the classic UI - plain text for now.
export const URI_PATH_SEGMENT_EDITOR =
  'Neos.Neos/Inspector/Editors/UriPathSegmentEditor'
export const SELECT_BOX_EDITOR = 'Neos.Neos/Inspector/Editors/SelectBoxEditor'
export const BOOLEAN_EDITOR = 'Neos.Neos/Inspector/Editors/BooleanEditor'

/**
 * Text field / text area / URI path segment. Holds the draft locally, reports
 * every keystroke through onChange, and commits on blur (or Enter, in the
 * single-line variant); Escape reverts the draft. Doubles as the number editor
 * for integer/float properties - an empty field clears the value, a non-number
 * is refused and reverts on commit.
 */
function TextEditorBody({
  multiline,
  subject,
  value,
  onCommit,
  onChange,
  options,
  autoFocus,
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
    if (parsed !== null && Number.isNaN(parsed)) return { ok: false, value: null }
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
      inputMode={isNumeric ? 'decimal' : undefined}
      onChange={(event) => change(event.target.value)}
      {...keyHandlers}
    />
  )
}

const TextFieldEditor: PropertyEditorComponent = (props) => (
  <TextEditorBody {...props} multiline={false} />
)

const TextAreaEditor: PropertyEditorComponent = (props) => (
  <TextEditorBody {...props} multiline={true} />
)

/** A boolean checkbox. No editing phase - it commits on every toggle. */
const BooleanEditor: PropertyEditorComponent = ({ value, onCommit }) => {
  const [checked, setChecked] = useState(value === true)
  return (
    <input
      type="checkbox"
      className="size-4 self-start accent-primary"
      checked={checked}
      onChange={(event) => {
        setChecked(event.target.checked)
        onCommit(event.target.checked)
      }}
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
 * A dropdown over the statically configured editorOptions.values -
 * single-select for scalar properties, multi-select (editorOptions.multiple,
 * the default for array properties) with the selection summarized in the
 * trigger. It holds the selection locally so a pick reflects instantly, ahead
 * of any refetch, and commits on every pick. Data sources (searchOnServer,
 * dataSourceIdentifier) are not supported yet and fall back to an empty list.
 */
const SelectBoxEditor: PropertyEditorComponent = ({
  value,
  onCommit,
  options,
}) => {
  const valuesConfig = (options.values ?? {}) as Record<
    string,
    SelectBoxValueConfig | null
  >
  const multiple = options.multiple === true
  const allowEmpty = options.allowEmpty === true
  const placeholder = plainEditorOption(options, 'placeholder') ?? '–'

  const items = sortByPosition(
    Object.entries(valuesConfig).map(([key, config]) => ({
      key,
      position: config?.position,
    })),
  ).map((key) => ({
    value: key,
    label: humanizeLabel(valuesConfig[key]?.label, key),
    icon: valuesConfig[key]?.icon ?? null,
  }))
  const labelFor = (key: string) =>
    items.find((item) => item.value === key)?.label ?? key

  const [selected, setSelected] = useState<string | string[] | null>(() => {
    if (multiple) {
      return Array.isArray(value)
        ? value.filter((v): v is string => typeof v === 'string')
        : []
    }
    return typeof value === 'string' && value !== '' ? value : null
  })

  const content = (
    <SelectContent>
      {/* A null item both renders the placeholder in the trigger and lets the
          user clear the value. */}
      {!multiple && allowEmpty && (
        <SelectItem value={null}>
          <span className="text-muted-foreground">{placeholder}</span>
        </SelectItem>
      )}
      {items.map((item) => (
        <SelectItem key={item.value} value={item.value}>
          {item.icon && <FaIcon icon={item.icon} />}
          {item.label}
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
          onCommit(values)
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
        {content}
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
        onCommit(selectedValue)
      }}
    >
      <SelectTrigger className="w-full">
        <SelectValue>
          {(current: string | null) =>
            current !== null ? (
              labelFor(current)
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )
          }
        </SelectValue>
      </SelectTrigger>
      {content}
    </Select>
  )
}

/**
 * Register the built-in editors. Called once before the app mounts, exactly
 * like third-party editors would be registered from a plugin entry point.
 */
export function registerBuiltinPropertyEditors(): void {
  propertyEditorRegistry.register({
    id: TEXT_FIELD_EDITOR,
    component: TextFieldEditor,
  })
  propertyEditorRegistry.register({
    id: URI_PATH_SEGMENT_EDITOR,
    component: TextFieldEditor,
  })
  propertyEditorRegistry.register({
    id: TEXT_AREA_EDITOR,
    component: TextAreaEditor,
  })
  propertyEditorRegistry.register({
    id: BOOLEAN_EDITOR,
    component: BooleanEditor,
  })
  propertyEditorRegistry.register({
    id: SELECT_BOX_EDITOR,
    component: SelectBoxEditor,
  })
}
