import { useState } from 'react'
import {
  DOCUMENT_NODE_TYPE,
  useResolvedNodes,
} from '@/api/neos/endpoints/nodes'
import { isOfType, useNodeTypes } from '@/api/neos/endpoints/nodeTypes'
import { editingSiteNode } from '@/api/neos/endpoints/sites'
import { nodeAddressOf, type Node, type NodeAddress } from '@/api/neos/schema'
import { useStudio, useStudioActions } from '@/app/StudioContext'
import { FieldIconButton } from '@/components/ui/field-icon-button'
import { resolveNodeTypeIconClass } from '@/features/tree/nodeTypeIcon'
import { moveItem } from '@/lib/arrays'
import { translate } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import {
  ReferencePicker,
  SelectedItemRow,
  type ReferenceOption,
} from './ReferencePicker'
import {
  referenceTargetState,
  type ReferenceTargetState,
} from './referenceValue'
import { useNodeSearch, type NodeSearchHit } from './useNodeSearch'

export interface NodePickerProps {
  /** The picked node aggregate ids, in order. The single variant shows the first. */
  value: readonly string[]
  /** The new selection: a pick, a removal, a reorder. Empty when cleared. */
  onChange: (ids: string[]) => void
  /** Pick several, listed as sortable rows above the search; one by default. */
  multiple?: boolean
  /**
   * A node in the subgraph (workspace and dimensions) to search and to
   * resolve the picked ids in, usually the edited node. Without one: the
   * active workspace and the selected document's dimensions, in the active
   * site.
   */
  nodeAddress?: NodeAddress
  /**
   * The node types to find: a list, or a comma-separated string in Neos'
   * NodeTypeCriteria syntax ("Neos.Neos:Document,!Acme:Folder"). Documents
   * by default.
   */
  nodeTypes?: string | readonly string[]
  /** How many characters start a search; 2 by default. */
  threshold?: number
  /** The empty field's text, plain; "Type to search" by default. */
  placeholder?: string
  /** Offer a data source's options instead of searching; their values are node aggregate ids. */
  dataSourceIdentifier?: string
  dataSourceAdditionalData?: Record<string, unknown>
  dataSourceDisableCaching?: boolean
  disabled?: boolean
  /** The id of the search trigger, for a field label to point at. */
  id?: string
}

interface TargetDisplay {
  id: string
  label: string
  iconClass: string | null
  state: ReferenceTargetState
  /** Set for a document target: the address to open in the preview. */
  documentAddress: NodeAddress | null
}

/**
 * A field to pick nodes by search: the picker of the reference editors, for
 * plugins too (a dialog, a link type tab, a settings section). Controlled -
 * it shows `value` and reports changes through `onChange`; the ids are
 * resolved in the subgraph for their labels, icons and states. An id that
 * no longer resolves (removed, or not readable) stays in the selection,
 * marked missing, until it is removed or replaced; a hidden target is
 * marked hidden, as it does not render in live.
 *
 * `knownNodes` (internal, not in the plugin API) are nodes the selection is
 * already known as - a graph reference's targets come with their nodes.
 */
export function NodePicker({
  value,
  onChange,
  multiple = false,
  nodeAddress,
  nodeTypes,
  threshold,
  placeholder,
  dataSourceIdentifier,
  dataSourceAdditionalData,
  dataSourceDisableCaching,
  disabled = false,
  id,
  knownNodes,
}: NodePickerProps & { knownNodes?: readonly Node[] }) {
  const { data: nodeTypeMap } = useNodeTypes()
  const { navigateToNode } = useStudioActions()
  const { site, workspaceName, selectedDocument } = useStudio()

  const [searchTerm, setSearchTerm] = useState('')
  const [open, setOpen] = useState(false)
  const [pickedById, setPickedById] = useState<Record<string, NodeSearchHit>>(
    {},
  )
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  // The live order while a row is dragged; committed on drop only.
  const [dragOrder, setDragOrder] = useState<string[] | null>(null)

  const selected = dragOrder ?? (multiple ? [...value] : value.slice(0, 1))

  const known = new Map(
    (knownNodes ?? []).map((node) => [node.nodeAggregateId, node]),
  )
  const resolved = useResolvedNodes(
    editingSiteNode(
      site,
      workspaceName,
      selectedDocument?.dimensionSpacePoint,
      nodeAddress,
    ),
    selected.filter((target) => !known.has(target)),
  )
  const nodeOf = (target: string) => known.get(target) ?? resolved.get(target)

  const search = useNodeSearch({
    searchTerm,
    nodeAddress,
    nodeTypes,
    threshold,
    dataSourceIdentifier,
    dataSourceAdditionalData,
    dataSourceDisableCaching,
    // A data source also labels selected values that are no node.
    enabled:
      open ||
      (!!dataSourceIdentifier &&
        selected.some((target) => nodeOf(target) === null)),
  })
  const dataSourceOptions = new Map(
    search.dataSourceOptions.map((option) => [option.id, option]),
  )

  const displayFor = (target: string): TargetDisplay => {
    const node = nodeOf(target)
    if (node) {
      return {
        id: target,
        label: node.label || node.nodeAggregateId,
        iconClass: resolveNodeTypeIconClass(nodeTypeMap, node.nodeType),
        state: referenceTargetState(node),
        documentAddress:
          nodeTypeMap &&
          isOfType(nodeTypeMap, node.nodeType, DOCUMENT_NODE_TYPE)
            ? nodeAddressOf(node)
            : null,
      }
    }
    // A fresh pick shows as picked until its node is read; a data source
    // option keeps its label when its value is no node.
    const option =
      dataSourceOptions.get(target) ??
      (node === undefined ? pickedById[target] : undefined)
    if (option) {
      return {
        id: target,
        label: option.label,
        iconClass: option.iconClass,
        state: 'resolved',
        documentAddress: null,
      }
    }
    return {
      id: target,
      label: target,
      iconClass: null,
      state: node === null ? 'missing' : 'loading',
      documentAddress: null,
    }
  }

  const pick = (option: ReferenceOption) => {
    setPickedById((cache) => ({ ...cache, [option.id]: option }))
    onChange(multiple ? [...selected, option.id] : [option.id])
  }

  const pickerProps = {
    id,
    disabled,
    options: search.hits.filter((hit) => !selected.includes(hit.id)),
    loading: search.loading,
    hint: search.hint,
    searchTerm,
    onSearchTermChange: setSearchTerm,
    onPick: pick,
    open,
    onOpenChange: (next: boolean) => {
      setOpen(next)
      if (!next) setSearchTerm('')
    },
  }
  const emptyText =
    placeholder || translate('editor.reference.typeToSearch', 'Type to search')
  const goToPageLabel = translate('editor.reference.goToPage', 'Go to page')

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
                <TargetLabel display={display} withIcon />
              ) : (
                <span className="text-muted-foreground">{emptyText}</span>
              )
            }
          />
        </div>
        {display?.documentAddress && (
          <FieldIconButton
            icon="fa-arrow-up-right-from-square"
            label={goToPageLabel}
            onClick={() => navigateToNode(display.documentAddress!)}
          />
        )}
        {current !== null && !disabled && (
          <FieldIconButton
            icon="fa-xmark"
            label={translate('editor.remove', 'Remove')}
            onClick={() => onChange([])}
          />
        )}
      </div>
    )
  }

  const draggable = !disabled && selected.length > 1
  const handleDragEnd = () => {
    const order = dragOrder
    setDragIndex(null)
    setDragOrder(null)
    if (order && order.join('\n') !== value.join('\n')) onChange(order)
  }

  return (
    <div className="flex flex-col gap-1">
      {selected.map((target, index) => {
        const display = displayFor(target)
        return (
          <SelectedItemRow
            key={target}
            draggable={draggable}
            onDragStart={(event) => {
              // Firefox only starts a drag once dataTransfer carries something.
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData('text/plain', target)
              setDragIndex(index)
              setDragOrder(selected)
            }}
            onDragOver={(event) => {
              event.preventDefault()
              if (dragIndex === null || dragIndex === index) return
              setDragOrder(moveItem(selected, dragIndex, index))
              setDragIndex(index)
            }}
            onDragEnd={handleDragEnd}
            className={cn(dragIndex === index && 'opacity-50')}
            leading={
              draggable && (
                <i
                  className="fas fa-grip-vertical type-icon-xl shrink-0 cursor-grab text-placeholder"
                  aria-hidden
                />
              )
            }
            iconClass={display.iconClass}
            label={
              <TargetLabel
                display={display}
                onOpen={
                  display.documentAddress
                    ? () => navigateToNode(display.documentAddress!)
                    : undefined
                }
              />
            }
            onRemove={
              disabled
                ? undefined
                : () => onChange(selected.filter((other) => other !== target))
            }
          />
        )
      })}
      <ReferencePicker
        {...pickerProps}
        triggerContent={
          <span className="text-muted-foreground">{emptyText}</span>
        }
      />
    </div>
  )
}

/** A target's label and state mark - only the mark when it is missing. */
function TargetLabel({
  display,
  withIcon = false,
  onOpen,
}: {
  display: TargetDisplay
  /** The single field draws the icon; a row has its own slot for it. */
  withIcon?: boolean
  /** Makes the label a link that opens the target (a row's go to page). */
  onOpen?: () => void
}) {
  if (display.state === 'missing') {
    return <StateMark target={display.id} state="missing" />
  }
  return (
    <>
      {withIcon && display.iconClass && (
        <i
          className={cn(
            display.iconClass,
            'fa-fw type-icon-m text-muted-foreground',
          )}
          aria-hidden
        />
      )}
      {onOpen ? (
        <button
          type="button"
          title={translate('editor.reference.goToPage', 'Go to page')}
          onClick={onOpen}
          className="min-w-0 truncate rounded-sm text-left outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {display.label}
        </button>
      ) : (
        <span className="truncate">{display.label}</span>
      )}
      <StateMark target={display.id} state={display.state} />
    </>
  )
}

/** The missing or hidden mark of a target; nothing for the others. */
function StateMark({
  target,
  state,
}: {
  target: string
  state: ReferenceTargetState
}) {
  if (state === 'missing') {
    return (
      <span
        className="flex min-w-0 items-center gap-1.5 text-destructive-text"
        title={translate(
          'editor.reference.missingTitle',
          'Not found - removed, or not readable: {0}',
          [target],
        )}
        data-state="missing"
      >
        <i
          className="fas fa-triangle-exclamation fa-fw type-icon-m"
          aria-hidden
        />
        <span className="truncate">
          {translate('editor.reference.missing', 'Missing')}
        </span>
      </span>
    )
  }
  if (state === 'hidden') {
    return (
      <span
        className="ml-auto flex shrink-0 items-center gap-1 type-small text-muted-foreground"
        title={translate(
          'editor.reference.hiddenTitle',
          'Hidden - does not show on the live site',
        )}
        data-state="hidden"
      >
        <i className="fas fa-eye-slash type-icon-s" aria-hidden />
        {translate('editor.reference.hidden', 'Hidden')}
      </span>
    )
  }
  return null
}
