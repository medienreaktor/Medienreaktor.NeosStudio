import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { GripVerticalIcon, Loader2Icon, SearchIcon, XIcon } from 'lucide-react'
import { dataSourceSelectOptions, useDataSource } from '@/api/dataSources'
import { queryKeys } from '@/api/keys'
import { addressWithAggregateId } from '@/api/nodeAddress'
import { nodeLabel, searchNodes, useNodeReferences } from '@/api/nodes'
import { useNodeTypes } from '@/api/nodeTypes'
import { useStudio } from '@/app/StudioContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { toast } from '@/components/ui/toast'
import { plainEditorOption } from '@/features/inspector/inspectorSchema'
import {
  faClassName,
  resolveNodeTypeIconClass,
} from '@/features/tree/nodeTypeIcon'
import { cn } from '@/lib/utils'
import type { PropertyEditorComponent, PropertyEditorProps } from '../registry'

export const REFERENCE_EDITOR = 'Neos.Neos/Inspector/Editors/ReferenceEditor'
export const REFERENCES_EDITOR = 'Neos.Neos/Inspector/Editors/ReferencesEditor'

/** One pickable target, normalized from a node search hit or a data source option. */
interface ReferenceOption {
  /** The node aggregate id - what a reference stores. */
  id: string
  label: string
  /** Complete Font Awesome class, already resolved (node type icon or data source icon). */
  iconClass: string | null
  /** Disambiguation line under the label - the document breadcrumb for search hits. */
  secondary?: string
  group?: string
  disabled?: boolean
}

/**
 * The pickable options for a reference editor. Two sources, mirroring the
 * select box editor: a data source (editorOptions.dataSourceIdentifier) whose
 * option values are node aggregate ids - filtered client-side by the search
 * term - or the default fulltext node search over the current site
 * (editorOptions.nodeTypes, default documents), server-side with the old UI's
 * cadence: minimum `threshold` characters (default 2), 300 ms debounce.
 */
function useReferenceOptions(
  options: Record<string, unknown>,
  nodeAddress: string | undefined,
  searchTerm: string,
  open: boolean,
): { options: ReferenceOption[]; loading: boolean; hint: string | null } {
  const { data: nodeTypes } = useNodeTypes()
  const { site } = useStudio()

  const dataSourceIdentifier =
    plainEditorOption(options, 'dataSourceIdentifier') ?? null
  const additionalData =
    options.dataSourceAdditionalData &&
    typeof options.dataSourceAdditionalData === 'object'
      ? (options.dataSourceAdditionalData as Record<string, unknown>)
      : undefined
  const dataSource = useDataSource({
    identifier: dataSourceIdentifier,
    nodeAddress,
    additionalData,
    disableCaching: options.dataSourceDisableCaching === true,
  })
  useEffect(() => {
    if (dataSource.error)
      toast.error(dataSource.error, { title: 'Loading options failed' })
  }, [dataSource.error])

  const threshold =
    typeof options.threshold === 'number' && options.threshold >= 0
      ? options.threshold
      : 2
  const nodeTypesFilter = Array.isArray(options.nodeTypes)
    ? options.nodeTypes
        .filter((t): t is string => typeof t === 'string')
        .join(',')
    : typeof options.nodeTypes === 'string' && options.nodeTypes !== ''
      ? options.nodeTypes
      : 'Neos.Neos:Document'
  // Search the site the edited node lives in, within its subgraph (workspace +
  // dimensions); the creation dialog has no node yet and falls back to the
  // active site's address.
  const searchContext = site?.aggregateId
    ? nodeAddress
      ? addressWithAggregateId(nodeAddress, site.aggregateId)
      : site.nodeAddress
    : null

  const [debouncedTerm, setDebouncedTerm] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedTerm(searchTerm.trim()), 300)
    return () => clearTimeout(timer)
  }, [searchTerm])

  const searchEnabled =
    dataSourceIdentifier === null &&
    open &&
    searchContext !== null &&
    debouncedTerm.length >= threshold
  const search = useQuery({
    queryKey: queryKeys.nodes.search(
      searchContext ?? '',
      nodeTypesFilter,
      debouncedTerm,
    ),
    queryFn: () => searchNodes(searchContext!, debouncedTerm, nodeTypesFilter),
    enabled: searchEnabled,
  })
  useEffect(() => {
    if (search.error) toast.error(search.error, { title: 'Search failed' })
  }, [search.error])

  if (dataSourceIdentifier !== null) {
    const all = dataSourceSelectOptions(dataSource.data).map(
      (option): ReferenceOption => ({
        id: option.key,
        label: option.label,
        iconClass: option.icon ? faClassName(option.icon) : null,
        group: option.group,
        disabled: option.disabled,
      }),
    )
    const term = searchTerm.trim().toLowerCase()
    return {
      options: term
        ? all.filter((option) => option.label.toLowerCase().includes(term))
        : all,
      loading: dataSource.isPending,
      hint: null,
    }
  }

  return {
    options: (searchEnabled ? (search.data ?? []) : []).map(
      (node): ReferenceOption => ({
        id: node.aggregateId,
        label: nodeLabel(node),
        iconClass: resolveNodeTypeIconClass(nodeTypes, node.nodeType),
        secondary: node.breadcrumb.join(' › '),
      }),
    ),
    loading: searchEnabled && search.isPending,
    hint:
      searchTerm.trim().length < threshold
        ? `Type at least ${threshold} character${threshold === 1 ? '' : 's'} to search`
        : null,
  }
}

/**
 * The dropdown shared by both editors: a select-like trigger opening a popover
 * with the search input at the top ("search inside the field") and the
 * grouped option list below - ungrouped options first, then one labeled group
 * per distinct group value in first-seen order.
 *
 * Keyboard: focus stays in the search input (combobox pattern) while
 * ArrowUp/ArrowDown move a highlight through the flat option order -
 * skipping disabled entries, wrapping at the ends - Home/End jump, Enter
 * picks the highlighted option, Escape closes (the popover's own handling).
 * The highlight follows the mouse too, so both inputs share one state.
 */
function ReferencePicker({
  triggerContent,
  disabled = false,
  options,
  loading,
  hint,
  searchTerm,
  onSearchTermChange,
  onPick,
  open,
  onOpenChange,
}: {
  triggerContent: React.ReactNode
  disabled?: boolean
  options: ReferenceOption[]
  loading: boolean
  hint: string | null
  searchTerm: string
  onSearchTermChange: (term: string) => void
  onPick: (option: ReferenceOption) => void
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const close = () => onOpenChange(false)
  const listboxId = useId()
  const listRef = useRef<HTMLDivElement>(null)

  const ungrouped = options.filter((option) => option.group === undefined)
  const groups = new Map<string, ReferenceOption[]>()
  for (const option of options) {
    if (option.group === undefined) continue
    const group = groups.get(option.group) ?? []
    group.push(option)
    groups.set(option.group, group)
  }
  // The flat navigation order = the render order (ungrouped, then groups).
  const flatOptions = [...ungrouped, ...[...groups.values()].flat()]
  const flatIndexById = new Map(
    flatOptions.map((option, index) => [option.id, index]),
  )
  const firstEnabled = flatOptions.findIndex((option) => !option.disabled)

  const [highlighted, setHighlighted] = useState(0)
  // A changed result set (new search term, options loaded) restarts the
  // highlight at the top-most pickable option.
  useEffect(() => {
    setHighlighted(firstEnabled === -1 ? 0 : firstEnabled)
  }, [searchTerm, loading, options.length, firstEnabled])

  const highlight = (index: number) => {
    setHighlighted(index)
    listRef.current
      ?.querySelector(`[data-option-index="${index}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }
  const moveHighlight = (delta: number) => {
    if (flatOptions.length === 0 || firstEnabled === -1) return
    let next = highlighted
    for (let step = 0; step < flatOptions.length; step++) {
      next = (next + delta + flatOptions.length) % flatOptions.length
      if (!flatOptions[next].disabled) break
    }
    highlight(next)
  }
  const pickHighlighted = () => {
    const option = flatOptions[highlighted]
    if (option && !option.disabled) {
      onPick(option)
      close()
    }
  }

  const renderOption = (option: ReferenceOption) => {
    const index = flatIndexById.get(option.id)!
    return (
      <button
        key={option.id}
        id={`${listboxId}-option-${index}`}
        data-option-index={index}
        role="option"
        aria-selected={index === highlighted}
        type="button"
        tabIndex={-1}
        disabled={option.disabled}
        onClick={() => {
          onPick(option)
          close()
        }}
        onMouseMove={() => {
          if (index !== highlighted) setHighlighted(index)
        }}
        className={cn(
          'flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm disabled:pointer-events-none disabled:opacity-50',
          index === highlighted && 'bg-neutral-800',
        )}
      >
        {option.iconClass && (
          <i
            className={cn(
              option.iconClass,
              'fa-fw mt-0.5 text-[0.75rem] text-neutral-400',
            )}
            aria-hidden
          />
        )}
        <span className="min-w-0">
          <span className="block truncate">{option.label}</span>
          {option.secondary && (
            <span className="block truncate text-xs text-neutral-400">
              {option.secondary}
            </span>
          )}
        </span>
      </button>
    )
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        disabled={disabled}
        className="flex h-9 w-full items-center gap-2 rounded-md border border-neutral-700 bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-blue-500 focus-visible:ring-[3px] focus-visible:ring-blue-500/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-neutral-700/30 dark:hover:bg-neutral-700/50"
      >
        {triggerContent}
      </PopoverTrigger>
      <PopoverContent className="w-(--anchor-width) p-1">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-neutral-400" />
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <Input
            autoFocus
            role="combobox"
            aria-expanded
            aria-controls={listboxId}
            aria-activedescendant={
              flatOptions[highlighted]
                ? `${listboxId}-option-${highlighted}`
                : undefined
            }
            value={searchTerm}
            onChange={(event) => onSearchTermChange(event.target.value)}
            onKeyDown={(event) => {
              switch (event.key) {
                case 'ArrowDown':
                  event.preventDefault()
                  moveHighlight(1)
                  break
                case 'ArrowUp':
                  event.preventDefault()
                  moveHighlight(-1)
                  break
                case 'Home':
                  if (firstEnabled !== -1) {
                    event.preventDefault()
                    highlight(firstEnabled)
                  }
                  break
                case 'End':
                  if (firstEnabled !== -1) {
                    event.preventDefault()
                    highlight(
                      flatOptions.length -
                        1 -
                        [...flatOptions]
                          .reverse()
                          .findIndex((option) => !option.disabled),
                    )
                  }
                  break
                case 'Enter':
                  event.preventDefault()
                  pickHighlighted()
                  break
              }
            }}
            placeholder="Search…"
            className="h-8 pl-8"
          />
        </div>
        <div
          ref={listRef}
          id={listboxId}
          role="listbox"
          className="mt-1 max-h-64 overflow-y-auto"
        >
          {loading ? (
            <div className="flex items-center gap-2 px-2 py-2 text-xs text-neutral-400">
              <Loader2Icon className="size-3.5 animate-spin" /> Searching…
            </div>
          ) : options.length === 0 ? (
            <p className="px-2 py-2 text-xs text-neutral-400">
              {hint ?? 'No matches'}
            </p>
          ) : (
            <>
              {ungrouped.map(renderOption)}
              {[...groups.entries()].map(([group, groupOptions]) => (
                <div key={group}>
                  <p className="px-2 py-1.5 text-xs text-neutral-400">
                    {group}
                  </p>
                  {groupOptions.map(renderOption)}
                </div>
              ))}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/**
 * Reference (single) and References (multi) editors, modelled on the old UI:
 * search-as-you-type over site documents (or a data source's curated list),
 * committing node aggregate ids - the inspector persists them with
 * SetNodeReferences. The multi variant lists the selection as sortable rows
 * (order is the stored order; the MultiAssetFieldEditor drag pattern) with a
 * picker below to add more; the single variant is the picker itself plus a
 * clear button.
 *
 * The current value is resolved through the node's references relation
 * (reference "properties" are not in node.properties in Neos 9); fresh picks
 * display from a local cache until the refetch lands. Selection state is
 * server-derived until the first local edit, then owned here - the inspector
 * remounts the editor when the edited subject changes.
 */
function ReferenceEditorBase({
  subject,
  onCommit,
  options,
  nodeAddress,
  multiple,
}: PropertyEditorProps & { multiple: boolean }) {
  const { data: nodeTypes } = useNodeTypes()
  const { data: references } = useNodeReferences(nodeAddress ?? null)
  const serverTargets = useMemo(
    () =>
      (references ?? [])
        .filter((reference) => reference.referenceName === subject.name)
        .map((reference) => reference.node),
    [references, subject.name],
  )

  const [dirty, setDirty] = useState<string[] | null>(null)
  const [pickedById, setPickedById] = useState<Record<string, ReferenceOption>>(
    {},
  )
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)

  const selected = dirty ?? serverTargets.map((node) => node.aggregateId)
  const picker = useReferenceOptions(
    options,
    nodeAddress,
    searchTerm,
    pickerOpen,
  )

  const commit = (ids: string[]) => {
    setDirty(ids)
    onCommit(multiple ? ids : (ids[0] ?? null))
  }

  const displayFor = (
    id: string,
  ): { label: string; iconClass: string | null } => {
    const node = serverTargets.find((target) => target.aggregateId === id)
    if (node) {
      return {
        label: nodeLabel(node),
        iconClass: resolveNodeTypeIconClass(nodeTypes, node.nodeType),
      }
    }
    // A fresh pick, shown from the picked option until the refetch lands - or
    // a target not visible in this subgraph, shown as its bare id.
    return pickedById[id] ?? { label: id, iconClass: null }
  }

  const pick = (option: ReferenceOption) => {
    setPickedById((cache) => ({ ...cache, [option.id]: option }))
    commit(multiple ? [...selected, option.id] : [option.id])
  }

  if (nodeAddress === undefined) {
    // The creation dialog: the node does not exist yet, and references cannot
    // ride along in CreateNodeAggregateWithNode's property values.
    return (
      <div className="flex min-h-9 items-center rounded-md border border-dashed border-neutral-700 px-3 py-2 text-sm text-neutral-400">
        References can be set after creation
      </div>
    )
  }

  const placeholder =
    plainEditorOption(options, 'placeholder') ?? 'Type to search'
  const availableOptions = picker.options.filter(
    (option) => !selected.includes(option.id),
  )

  const pickerProps = {
    options: availableOptions,
    loading: picker.loading,
    hint: picker.hint,
    searchTerm,
    onSearchTermChange: setSearchTerm,
    onPick: pick,
    open: pickerOpen,
    onOpenChange: (open: boolean) => {
      setPickerOpen(open)
      if (!open) setSearchTerm('')
    },
  }

  if (!multiple) {
    const current = selected[0] ?? null
    const display = current !== null ? displayFor(current) : null
    return (
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1">
          <ReferencePicker
            {...pickerProps}
            triggerContent={
              display ? (
                <>
                  {display.iconClass && (
                    <i
                      className={cn(
                        display.iconClass,
                        'fa-fw text-[0.75rem] text-neutral-400',
                      )}
                      aria-hidden
                    />
                  )}
                  <span className="truncate">{display.label}</span>
                </>
              ) : (
                <span className="text-neutral-400">{placeholder}</span>
              )
            }
          />
        </div>
        {current !== null && (
          <Button
            variant="ghost"
            size="icon-sm"
            title="Remove"
            onClick={() => commit([])}
          >
            <XIcon />
          </Button>
        )}
      </div>
    )
  }

  // Reorder live as the pointer passes over another row; persist on drop only,
  // so a drag does not fire a save per hovered row.
  const handleDragOver = (index: number) => {
    if (dragIndex === null || dragIndex === index) return
    setDirty((current) => {
      const ids = [...(current ?? selected)]
      const [moved] = ids.splice(dragIndex, 1)
      ids.splice(index, 0, moved)
      return ids
    })
    setDragIndex(index)
  }
  const handleDragEnd = () => {
    setDragIndex(null)
    onCommit(dirty ?? selected)
  }

  const draggable = selected.length > 1

  return (
    <div className="flex flex-col gap-1">
      {selected.map((id, index) => {
        const display = displayFor(id)
        return (
          <div
            key={id}
            draggable={draggable}
            onDragStart={(event) => {
              // Firefox only starts a drag once dataTransfer carries something.
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData('text/plain', id)
              setDragIndex(index)
            }}
            onDragOver={(event) => {
              event.preventDefault()
              handleDragOver(index)
            }}
            onDragEnd={handleDragEnd}
            className={cn(
              'flex h-9 items-center gap-2 rounded-md border border-neutral-700 bg-neutral-950 px-2 text-sm',
              dragIndex === index && 'opacity-50',
            )}
          >
            {draggable && (
              <GripVerticalIcon className="size-4 shrink-0 cursor-grab text-neutral-600" />
            )}
            {display.iconClass && (
              <i
                className={cn(
                  display.iconClass,
                  'fa-fw text-[0.75rem] text-neutral-400',
                )}
                aria-hidden
              />
            )}
            <span className="min-w-0 flex-1 truncate">{display.label}</span>
            <Button
              variant="ghost"
              size="icon-sm"
              title="Remove"
              onClick={() => commit(selected.filter((other) => other !== id))}
            >
              <XIcon />
            </Button>
          </div>
        )
      })}
      <ReferencePicker
        {...pickerProps}
        triggerContent={<span className="text-neutral-400">{placeholder}</span>}
      />
    </div>
  )
}

export const ReferenceEditor: PropertyEditorComponent = (props) => (
  <ReferenceEditorBase {...props} multiple={false} />
)

export const ReferencesEditor: PropertyEditorComponent = (props) => (
  <ReferenceEditorBase {...props} multiple />
)
