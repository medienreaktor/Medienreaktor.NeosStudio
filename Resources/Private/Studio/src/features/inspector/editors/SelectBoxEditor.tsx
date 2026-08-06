import { useEffect, useMemo, useState } from 'react'
import { dataSourceSelectOptions, useDataSource } from '@/api/dataSources'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from '@/components/ui/toast'
import {
  humanizeLabel,
  plainEditorOption,
} from '@/features/inspector/inspectorSchema'
import { FaIcon } from '@/features/tree/nodeTypeIcon'
import { translate as t } from '@/lib/i18n'
import { sortByPosition } from '@/lib/positional'
import { cn } from '@/lib/utils'
import type { PropertyEditorComponent, PropertyEditorProps } from './registry'

export const SELECT_BOX_EDITOR = 'Neos.Neos/Inspector/Editors/SelectBoxEditor'

/** One selectable option from editorOptions.values. */
interface SelectBoxValueConfig {
  label?: string | null
  icon?: string | null
  group?: string | null
  position?: string | number
}

/** What the controls render - static and data-source options normalize to this. */
interface SelectBoxItem {
  /** Stable string key for the select control. */
  key: string
  /** What a pick commits - equals key for static options, the raw data source value otherwise. */
  value: unknown
  label: string
  icon?: string | null
  group?: string
  disabled?: boolean
}

/**
 * The select box editor over either the statically configured
 * editorOptions.values or a server-side data source
 * (editorOptions.dataSourceIdentifier). Scalar properties get a dropdown;
 * array properties (editorOptions.multiple) get a sortable list of the
 * selected values plus a dropdown to add more - matching the classic UI's
 * MultiSelectBox, where selection order is the stored order.
 */
export const SelectBoxEditor: PropertyEditorComponent = (props) => {
  if (
    plainEditorOption(props.options, 'dataSourceIdentifier') !== undefined ||
    props.options.dataSourceUri !== undefined
  ) {
    return <DataSourceSelectBox {...props} />
  }
  return <StaticSelectBox {...props} />
}

/** The classic editorOptions.values variant, options sorted by position. */
function StaticSelectBox({ value, onCommit, options }: PropertyEditorProps) {
  const valuesConfig = (options.values ?? {}) as Record<
    string,
    SelectBoxValueConfig | null
  >

  const items: SelectBoxItem[] = sortByPosition(
    Object.entries(valuesConfig).map(([key, config]) => ({
      key,
      position: config?.position,
    })),
  ).map((key) => ({
    key,
    value: key,
    label: humanizeLabel(valuesConfig[key]?.label, key),
    icon: valuesConfig[key]?.icon ?? null,
    group: valuesConfig[key]?.group ?? undefined,
  }))

  return (
    <SelectBoxControl
      items={items}
      value={value}
      onCommit={onCommit}
      options={options}
    />
  )
}

/**
 * Options loaded from /api/data-sources/{identifier}, passing the edited node
 * and editorOptions.dataSourceAdditionalData along - the same contract the
 * old UI's data-source-based select box speaks. Results are cached for the
 * session unless dataSourceDisableCaching is set; while options load (or when
 * loading failed) the control is disabled and the stored value shows as-is.
 * The dataSourceUri escape hatch (an arbitrary self-authenticated endpoint)
 * has no bearer-token equivalent and is not supported.
 */
function DataSourceSelectBox({
  value,
  onCommit,
  options,
  nodeAddress,
}: PropertyEditorProps) {
  const identifier = plainEditorOption(options, 'dataSourceIdentifier') ?? null
  const additionalData =
    options.dataSourceAdditionalData &&
    typeof options.dataSourceAdditionalData === 'object'
      ? (options.dataSourceAdditionalData as Record<string, unknown>)
      : undefined

  const { data, error, isPending } = useDataSource({
    identifier,
    nodeAddress,
    additionalData,
    disableCaching: options.dataSourceDisableCaching === true,
  })

  useEffect(() => {
    if (error)
      toast.error(error, {
        title: t('editor.loadingOptionsFailed', 'Loading options failed'),
      })
  }, [error])

  const items = useMemo(() => dataSourceSelectOptions(data), [data])

  if (identifier === null) {
    return (
      <div
        className="flex min-h-9 items-center rounded-md border border-dashed border-neutral-300 dark:border-neutral-700 px-3 py-2 text-sm text-neutral-600 dark:text-neutral-400"
        title={t(
          'editor.selectBox.dataSourceUriHint',
          'editorOptions.dataSourceUri is not supported in Studio - use dataSourceIdentifier',
        )}
      >
        {t(
          'editor.selectBox.dataSourceUnsupported',
          'Data source not supported',
        )}
      </div>
    )
  }

  return (
    <SelectBoxControl
      items={items}
      value={value}
      onCommit={onCommit}
      options={options}
      disabled={isPending || error !== null}
    />
  )
}

const optionItem = (item: SelectBoxItem) => (
  <SelectItem key={item.key} value={item.key} disabled={item.disabled}>
    {item.icon && <FaIcon icon={item.icon} />}
    {item.label}
  </SelectItem>
)

/**
 * Dropdown options: ungrouped ones first, then one labeled group per distinct
 * group value in first-seen order - matching the old UI's grouped rendering.
 */
function GroupedOptions({ items }: { items: SelectBoxItem[] }) {
  const ungrouped = items.filter((item) => item.group === undefined)
  const groups = new Map<string, SelectBoxItem[]>()
  for (const item of items) {
    if (item.group === undefined) continue
    const group = groups.get(item.group) ?? []
    group.push(item)
    groups.set(item.group, group)
  }

  return (
    <>
      {ungrouped.map(optionItem)}
      {[...groups.entries()].map(([group, groupItems]) => (
        <SelectGroup key={group}>
          <SelectLabel>{group}</SelectLabel>
          {groupItems.map(optionItem)}
        </SelectGroup>
      ))}
    </>
  )
}

/** Dispatch on multiplicity; both controls work on string keys and commit the items' original values. */
function SelectBoxControl({
  items,
  value,
  onCommit,
  options,
  disabled = false,
}: {
  items: SelectBoxItem[]
  value: unknown
  onCommit: (value: unknown) => void
  options: Record<string, unknown>
  disabled?: boolean
}) {
  const placeholder = plainEditorOption(options, 'placeholder') ?? '–'

  if (options.multiple === true) {
    return (
      <MultiSelectList
        items={items}
        value={value}
        onCommit={onCommit}
        // For the multi case allowEmpty defaults to true and gates removing
        // the last element - the old UI's MultiSelectBox semantics.
        allowEmpty={options.allowEmpty !== false}
        placeholder={placeholder}
        disabled={disabled}
      />
    )
  }

  return (
    <SingleSelect
      items={items}
      value={value}
      onCommit={onCommit}
      allowEmpty={options.allowEmpty === true}
      placeholder={placeholder}
      disabled={disabled}
    />
  )
}

/**
 * The single-select dropdown. It holds the selection locally so a pick
 * reflects instantly, ahead of any refetch, and commits on every pick.
 */
function SingleSelect({
  items,
  value,
  onCommit,
  allowEmpty,
  placeholder,
  disabled,
}: {
  items: SelectBoxItem[]
  value: unknown
  onCommit: (value: unknown) => void
  allowEmpty: boolean
  placeholder: string
  disabled: boolean
}) {
  const [selected, setSelected] = useState<string | null>(() =>
    (typeof value === 'string' || typeof value === 'number') && value !== ''
      ? String(value)
      : null,
  )

  // A key not (or no longer) among the items - a stale stored value, or one
  // arriving before its data source - still commits back as its string key.
  const valueFor = (key: string) =>
    items.find((item) => item.key === key)?.value ?? key

  // The selected value renders like its list item - icon plus label.
  // SelectValue is a flex row (gap-2 via the trigger styles).
  const selectedItem = (key: string) => {
    const item = items.find((candidate) => candidate.key === key)
    return (
      <span className="flex items-center gap-2">
        {item?.icon && <FaIcon icon={item.icon} />}
        {item?.label ?? key}
      </span>
    )
  }

  return (
    <Select
      disabled={disabled}
      value={selected}
      onValueChange={(next) => {
        const key = next as string | null
        setSelected(key)
        // null unsets the property - matches allowEmpty semantics.
        onCommit(key === null ? null : valueFor(key))
      }}
    >
      <SelectTrigger className="w-full">
        <SelectValue>
          {(current: string | null) =>
            current !== null ? (
              selectedItem(current)
            ) : (
              <span className="text-neutral-600 dark:text-neutral-400">{placeholder}</span>
            )
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {/* A null item both renders the placeholder in the trigger and lets
            the user clear the value. */}
        {allowEmpty && (
          <SelectItem value={null}>
            <span className="text-neutral-600 dark:text-neutral-400">{placeholder}</span>
          </SelectItem>
        )}
        <GroupedOptions items={items} />
      </SelectContent>
    </Select>
  )
}

/**
 * The multi-select, modelled on the old UI's MultiSelectBox: the selected
 * values as a list - order is the stored order, rows drag to reorder (the
 * MultiAssetFieldEditor pattern: reorder live on drag-over, persist on drop)
 * and remove with ×, the last one only if allowEmpty - plus a dropdown below
 * offering the not-yet-selected options to add. State is seeded once from
 * `value` and thereafter owned here; the inspector remounts the editor when
 * the edited subject changes, which resets it.
 */
function MultiSelectList({
  items,
  value,
  onCommit,
  allowEmpty,
  placeholder,
  disabled,
}: {
  items: SelectBoxItem[]
  value: unknown
  onCommit: (value: unknown) => void
  allowEmpty: boolean
  placeholder: string
  disabled: boolean
}) {
  const [selected, setSelected] = useState<string[]>(() =>
    Array.isArray(value)
      ? value
          .filter(
            (v): v is string | number =>
              typeof v === 'string' || typeof v === 'number',
          )
          .map(String)
      : [],
  )
  // The row being dragged, tracked while a reorder is in progress.
  const [dragIndex, setDragIndex] = useState<number | null>(null)

  const itemFor = (key: string) =>
    items.find((candidate) => candidate.key === key)
  const valueFor = (key: string) => itemFor(key)?.value ?? key

  const commit = (next: string[]) => {
    setSelected(next)
    onCommit(next.map(valueFor))
  }

  const handleDragOver = (index: number) => {
    if (dragIndex === null || dragIndex === index) return
    setSelected((current) => {
      const next = [...current]
      const [moved] = next.splice(dragIndex, 1)
      next.splice(index, 0, moved)
      return next
    })
    setDragIndex(index)
  }

  const handleDragEnd = () => {
    setDragIndex(null)
    onCommit(selected.map(valueFor))
  }

  const available = items.filter((item) => !selected.includes(item.key))
  const draggable = !disabled && selected.length > 1
  const removable = !disabled && (allowEmpty || selected.length > 1)

  return (
    <div className="flex flex-col gap-1">
      {selected.map((key, index) => {
        const item = itemFor(key)
        return (
          <div
            key={key}
            draggable={draggable}
            onDragStart={(event) => {
              // Firefox only starts a drag once dataTransfer carries something.
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData('text/plain', key)
              setDragIndex(index)
            }}
            onDragOver={(event) => {
              event.preventDefault()
              handleDragOver(index)
            }}
            onDragEnd={handleDragEnd}
            className={cn(
              'flex h-9 items-center gap-2 rounded-md border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-950 px-2 text-sm',
              dragIndex === index && 'opacity-50',
            )}
          >
            {draggable && (
              <i
                className="fas fa-grip-vertical text-[1rem] shrink-0 cursor-grab text-neutral-400 dark:text-neutral-600"
                aria-hidden
              />
            )}
            {item?.icon && <FaIcon icon={item.icon} />}
            <span className="min-w-0 flex-1 truncate">
              {item?.label ?? key}
            </span>
            {removable && (
              <Button
                variant="ghost"
                size="icon-sm"
                title={t('editor.remove', 'Remove')}
                onClick={() =>
                  commit(selected.filter((candidate) => candidate !== key))
                }
              >
                <i className="fas fa-xmark" aria-hidden />
              </Button>
            )}
          </div>
        )
      })}
      <Select
        disabled={disabled || available.length === 0}
        // Always the placeholder: this select only ever *adds* a value.
        value={null}
        onValueChange={(next) => {
          if (typeof next === 'string') commit([...selected, next])
        }}
      >
        <SelectTrigger className="w-full">
          <SelectValue>
            {() => <span className="text-neutral-600 dark:text-neutral-400">{placeholder}</span>}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <GroupedOptions items={available} />
        </SelectContent>
      </Select>
    </div>
  )
}
