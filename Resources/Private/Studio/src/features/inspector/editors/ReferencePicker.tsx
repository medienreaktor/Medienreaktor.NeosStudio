import { useRef } from 'react'

import { FieldIconButton } from '@/components/ui/field-icon-button'
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxStatus,
  ComboboxTrigger,
} from '@/components/ui/combobox'
import { translate } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/** One pickable entry - a node search hit, a data source option, a tag... */
export interface ReferenceOption {
  /** What the selection stores (a node aggregate id, a tag id, ...). */
  id: string
  label: string
  /** Complete Font Awesome class, already resolved. */
  iconClass: string | null
  /** Disambiguation line under the label - a breadcrumb, a parent path. */
  secondary?: string
  group?: string
  disabled?: boolean
  /** Set in a tree listing: the nesting level (0 = root), indents the row. */
  depth?: number
  /** Set for a tree entry with children: whether they are listed. */
  expanded?: boolean
  /** Expands / collapses a tree entry (the chevron, or → / ←). */
  onToggleExpanded?: () => void
  /**
   * Already chosen - listed with a check instead of its icon (a tree keeps
   * chosen entries in place, as they carry the structure).
   */
  checked?: boolean
}

/** A node of a tree a picker lists (tags, nested collections, ...). */
export interface PickerTreeNode {
  id: string
  label: string
  children: PickerTreeNode[]
}

/**
 * The options for picking from a tree. Without a search term: the tree in
 * order, indented, with expandable entries (all expanded unless `collapsed`);
 * with one: a flat list of every entry whose label or parent path matches,
 * the parent path as the secondary line. Entries in `checkedIds` are marked.
 */
export function treePickerOptions({
  roots,
  searchTerm,
  collapsed,
  onToggleExpanded,
  iconClass,
  checkedIds,
}: {
  roots: PickerTreeNode[]
  searchTerm: string
  collapsed: ReadonlySet<string>
  onToggleExpanded: (id: string) => void
  iconClass: string | null
  checkedIds: ReadonlySet<string>
}): ReferenceOption[] {
  const options: ReferenceOption[] = []
  const needle = searchTerm.trim().toLowerCase()
  const visit = (nodes: PickerTreeNode[], path: string[]) => {
    for (const node of nodes) {
      const secondary = path.join(' › ')
      if (needle !== '') {
        if (
          node.label.toLowerCase().includes(needle) ||
          secondary.toLowerCase().includes(needle)
        ) {
          options.push({
            id: node.id,
            label: node.label,
            iconClass,
            secondary: secondary || undefined,
            checked: checkedIds.has(node.id),
          })
        }
        visit(node.children, [...path, node.label])
        continue
      }
      const hasChildren = node.children.length > 0
      const expanded = hasChildren && !collapsed.has(node.id)
      options.push({
        id: node.id,
        label: node.label,
        iconClass,
        depth: path.length,
        expanded: hasChildren ? expanded : undefined,
        onToggleExpanded: hasChildren
          ? () => onToggleExpanded(node.id)
          : undefined,
        checked: checkedIds.has(node.id),
      })
      if (expanded) visit(node.children, [...path, node.label])
    }
  }
  visit(roots, [])
  return options
}

/** Stops a press on the chevron from reaching the item (which would pick it). */
const stop = (event: React.SyntheticEvent) => {
  event.stopPropagation()
  event.preventDefault()
}

/** Options grouped as the list renders them: ungrouped first (value ''), then one per group value, in first-seen order. */
interface ReferenceOptionGroup {
  value: string
  items: ReferenceOption[]
}

/**
 * The dropdown of the reference editors, shared with every other "pick some
 * of these" field (the asset dialog's tags and collections) so they all look
 * and behave the same - Base UI's combobox: a select-like trigger opening a
 * popup with the search input at the top ("search inside the field") and the
 * grouped option list below - ungrouped options first, then one labeled group
 * per distinct group value in first-seen order. The combobox does the
 * keyboard handling (arrows move the highlight, skipping disabled options;
 * Enter picks; Escape closes); the options arrive filtered (server-side
 * search, or filtered by the caller), so it filters nothing itself.
 *
 * Options may form a tree (see treePickerOptions): rows indent by depth and
 * expandable ones carry a chevron; with an empty search, → and ← expand and
 * collapse the highlighted entry.
 */
export function ReferencePicker({
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
  closeOnPick = true,
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
  /** False keeps the popup open after a pick, to add several in a row. */
  closeOnPick?: boolean
}) {
  const highlighted = useRef<ReferenceOption | undefined>(undefined)
  const groups: ReferenceOptionGroup[] = []
  for (const option of options) {
    const value = option.group ?? ''
    let group = groups.find((candidate) => candidate.value === value)
    if (!group) {
      group = { value, items: [] }
      // Ungrouped options lead.
      if (value === '') groups.unshift(group)
      else groups.push(group)
    }
    group.items.push(option)
  }

  return (
    <Combobox<ReferenceOption>
      items={groups}
      filter={null}
      // Picking only ever adds - the editor shows the selection itself.
      value={null}
      onValueChange={(option) => {
        if (option) onPick(option)
        if (closeOnPick) onOpenChange(false)
        else onSearchTermChange('')
      }}
      inputValue={searchTerm}
      onInputValueChange={(term, details) => {
        // A pick fills the input with the label - not a search.
        if (details.reason !== 'item-press') onSearchTermChange(term)
      }}
      open={open}
      onOpenChange={(next, details) => {
        // Base UI closes a single-select combobox on every pick - unless the
        // caller wants to pick several in a row.
        if (!next && !closeOnPick && details.reason === 'item-press') return
        onOpenChange(next)
      }}
      itemToStringLabel={(option) => option.label}
      isItemEqualToValue={(option, other) => option.id === other.id}
      autoHighlight
      onItemHighlighted={(option) => {
        highlighted.current = option
      }}
      disabled={disabled}
    >
      <ComboboxTrigger>{triggerContent}</ComboboxTrigger>
      <ComboboxContent>
        <div className="relative">
          <i
            className="fas fa-magnifying-glass pointer-events-none absolute top-1/2 left-2 type-icon-xl -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <ComboboxInput
            placeholder={translate('editor.searchPlaceholder', 'Search…')}
            className="h-7.5 pl-7.5"
            onKeyDown={(event) => {
              // An empty input has no caret to move - the arrows walk the tree.
              const option = highlighted.current
              if (searchTerm !== '' || !option?.onToggleExpanded) return
              if (
                (event.key === 'ArrowRight' && option.expanded === false) ||
                (event.key === 'ArrowLeft' && option.expanded === true)
              ) {
                event.preventDefault()
                option.onToggleExpanded()
              }
            }}
          />
        </div>
        <ComboboxStatus>
          {loading ? (
            <>
              <i className="fas fa-spinner fa-spin type-icon-l" aria-hidden />
              {translate('editor.searching', 'Searching…')}
            </>
          ) : options.length === 0 && hint !== null ? (
            hint
          ) : null}
        </ComboboxStatus>
        <ComboboxEmpty>
          {!loading && hint === null
            ? translate('editor.noMatches', 'No matches')
            : null}
        </ComboboxEmpty>
        <ComboboxList className="mt-1">
          {(group: ReferenceOptionGroup) => (
            <ComboboxGroup key={group.value} items={group.items}>
              {group.value !== '' && (
                <ComboboxGroupLabel>{group.value}</ComboboxGroupLabel>
              )}
              <ComboboxCollection>
                {(option: ReferenceOption) => (
                  <ComboboxItem
                    key={option.id}
                    value={option}
                    disabled={option.disabled}
                    style={
                      option.depth !== undefined
                        ? { paddingLeft: `${0.5 + option.depth}rem` }
                        : undefined
                    }
                  >
                    {option.depth !== undefined &&
                      (option.onToggleExpanded ? (
                        <span
                          aria-hidden
                          className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                          onPointerDown={stop}
                          onMouseDown={stop}
                          onPointerUp={stop}
                          onMouseUp={stop}
                          onClick={(event) => {
                            stop(event)
                            option.onToggleExpanded?.()
                          }}
                        >
                          <i
                            className={cn(
                              'fas fa-chevron-right type-icon-s transition-transform',
                              option.expanded && 'rotate-90',
                            )}
                          />
                        </span>
                      ) : (
                        <span className="size-4 shrink-0" aria-hidden />
                      ))}
                    {option.checked ? (
                      <i
                        className="fas fa-check fa-fw mt-0.5 type-icon-m text-primary-text"
                        aria-hidden
                      />
                    ) : (
                      option.iconClass && (
                        <i
                          className={cn(
                            option.iconClass,
                            'fa-fw mt-0.5 type-icon-m text-muted-foreground',
                          )}
                          aria-hidden
                        />
                      )
                    )}
                    <span className="min-w-0">
                      <span className="block truncate">{option.label}</span>
                      {option.secondary && (
                        <span className="block truncate type-small text-muted-foreground">
                          {option.secondary}
                        </span>
                      )}
                    </span>
                  </ComboboxItem>
                )}
              </ComboboxCollection>
            </ComboboxGroup>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}

/**
 * One selected entry above a ReferencePicker: a bordered row with an optional
 * leading slot (drag grip), the icon, the label (or a custom label node, e.g.
 * a link) and a remove button. Extra div props (drag handlers) pass through.
 */
export function SelectedItemRow({
  leading,
  iconClass,
  label,
  secondary,
  onRemove,
  removeLabel = translate('editor.remove', 'Remove'),
  className,
  ...props
}: Omit<React.ComponentProps<'div'>, 'children'> & {
  leading?: React.ReactNode
  iconClass: string | null
  label: React.ReactNode
  secondary?: string
  onRemove?: () => void
  removeLabel?: string
}) {
  return (
    <div
      className={cn(
        'flex min-h-8.5 items-center gap-2 rounded-md border border-border bg-background px-2 type-body',
        className,
      )}
      {...props}
    >
      {leading}
      {iconClass && (
        <i
          className={cn(iconClass, 'fa-fw type-icon-m text-muted-foreground')}
          aria-hidden
        />
      )}
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
        {typeof label === 'string' ? (
          <span className="truncate">{label}</span>
        ) : (
          label
        )}
        {secondary && (
          <span className="truncate type-small text-muted-foreground">
            {secondary}
          </span>
        )}
      </span>
      {onRemove && (
        <FieldIconButton
          icon="fa-xmark"
          label={removeLabel}
          onClick={onRemove}
        />
      )}
    </div>
  )
}
