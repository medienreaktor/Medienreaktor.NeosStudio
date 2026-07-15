import { useState } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  humanizeLabel,
  plainEditorOption,
} from '@/features/inspector/inspectorSchema'
import { FaIcon } from '@/features/tree/nodeTypeIcon'
import { sortByPosition } from '@/lib/positional'
import type { PropertyEditorComponent } from '../registry'

export const SELECT_BOX_EDITOR = 'Neos.Neos/Inspector/Editors/SelectBoxEditor'

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
export const SelectBoxEditor: PropertyEditorComponent = ({
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
          <span className="text-neutral-400">{placeholder}</span>
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
                <span className="text-neutral-400">{placeholder}</span>
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
              <span className="text-neutral-400">{placeholder}</span>
            )
          }
        </SelectValue>
      </SelectTrigger>
      {content}
    </Select>
  )
}
