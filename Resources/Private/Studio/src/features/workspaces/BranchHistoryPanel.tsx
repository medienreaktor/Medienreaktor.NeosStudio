import { useEffect, useMemo, useRef, useState } from 'react'
import {
  useWorkspacePendingEventsDiff,
  type WorkspacePendingDiffChange,
  type WorkspacePendingDiffEvent,
  type WorkspacePendingStep,
} from '@/api/workspaces'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { faClassName } from '@/features/tree/nodeTypeIcon'
import { translate as t, translateLabel } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import {
  eventTypeLabel,
  relativeTime,
  stepIcon,
  stepSummary,
} from './historyLabels'
import type { WorkspaceBranch } from './workspaceGraphModel'

/**
 * The history log of one branch in the Workspaces graph: its editing steps
 * newest first - a git log for the workspace. Opens when a head card or a
 * commit dot is picked; a picked dot's step starts expanded. Expanding a step
 * lazily fetches its before/after diff (the pending-events diff resource) and
 * shows, per event, what changed: old value struck out, new value below.
 * "Go to page" follows the step's document into the editing context.
 */

/** A serialized property value rendered as a compact one-liner. */
function formatValue(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'string') {
    // RTE properties carry HTML - the diff shows readable text.
    const text = value
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    return text === '' ? null : text
  }
  if (typeof value === 'boolean') {
    return value
      ? t('workspaceHistory.value.yes', 'yes')
      : t('workspaceHistory.value.no', 'no')
  }
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) {
    if (value.length === 0) return null
    const parts = value.map((item) =>
      item !== null && typeof item === 'object'
        ? formatValue(item)
        : String(item),
    )
    return parts.filter((part) => part !== null).join(', ') || null
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    // Node descriptors ({id,label}) read by label; dimension coordinates
    // ("language: de") and other small objects as key/value pairs.
    if ('id' in record) {
      return typeof record.label === 'string' ? record.label : String(record.id)
    }
    const pairs = Object.entries(record).map(
      ([key, entry]) => `${key}: ${formatValue(entry) ?? '–'}`,
    )
    return pairs.length > 0 ? pairs.join(', ') : null
  }
  return String(value)
}

/** The row label of one change: the property's configured (translated) label,
 * its raw name, or the kind's generic label. */
function changeLabel(change: WorkspacePendingDiffChange): string {
  if (change.label !== null) {
    const translated = translateLabel(change.label)
    if (translated !== null) return translated
  }
  if (change.property !== null) return change.property
  switch (change.kind) {
    case 'nodeType':
      return t('workspaceHistory.change.nodeType', 'Node type')
    case 'name':
      return t('workspaceHistory.change.name', 'Name')
    case 'parent':
      return t('workspaceHistory.change.parent', 'Parent')
    case 'position':
      return t('workspaceHistory.change.position', 'Position')
    case 'variant':
      return t('workspaceHistory.change.variant', 'Dimension')
    default:
      return change.kind
  }
}

function ChangeRow({ change }: { change: WorkspacePendingDiffChange }) {
  if (change.kind === 'position') {
    return (
      <div className="text-neutral-400">
        {t('workspaceHistory.change.reordered', 'Reordered among its siblings')}
      </div>
    )
  }
  const oldText = formatValue(change.old)
  const newText = formatValue(change.new)
  const empty = (
    <span className="text-neutral-500 italic">
      {t('workspaceHistory.value.empty', 'empty')}
    </span>
  )
  return (
    <div className="min-w-0">
      <div className="truncate text-[10px] font-medium text-neutral-400">
        {changeLabel(change)}
      </div>
      {oldText !== newText && (
        <div className="wrap-break-word text-red-400/90 line-through">
          {oldText ?? empty}
        </div>
      )}
      <div className="wrap-break-word text-green-400/90">
        {newText ?? empty}
      </div>
    </div>
  )
}

/** One diffed event inside an expanded step: which node, then its changes. */
function DiffEvent({
  event,
  showNode,
}: {
  event: WorkspacePendingDiffEvent
  showNode: boolean
}) {
  return (
    <div className="flex flex-col gap-1">
      {showNode && (
        <div className="flex min-w-0 items-center gap-1.5 text-neutral-300">
          <i
            className={cn(
              event.icon ? faClassName(event.icon) : 'fas fa-cube',
              'fa-fw shrink-0 text-[0.65rem] text-neutral-500',
            )}
            aria-hidden
          />
          <span className="truncate">
            {event.nodeLabel ??
              event.nodeAggregateId ??
              t('workspaceGraph.unknownNode', 'Unknown node')}
          </span>
          <span className="shrink-0 text-[9px] text-neutral-500">
            {eventTypeLabel(event.type)}
          </span>
        </div>
      )}
      {event.changes.map((change, index) => (
        <ChangeRow key={index} change={change} />
      ))}
      {event.changes.length === 0 && !showNode && (
        <div className="text-neutral-500">{eventTypeLabel(event.type)}</div>
      )}
    </div>
  )
}

/** The lazily fetched before/after body of an expanded step. */
function StepDiff({
  workspaceName,
  step,
}: {
  workspaceName: string
  step: WorkspacePendingStep
}) {
  const { data, isLoading, isError } = useWorkspacePendingEventsDiff(
    workspaceName,
    step.from,
    step.to,
  )
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-1 text-neutral-500">
        <Spinner className="size-3" />
        {t('workspaceHistory.loadingDiff', 'Loading changes…')}
      </div>
    )
  }
  if (isError || !data) {
    return (
      <div className="py-1 text-neutral-500">
        {t('workspaceHistory.diffFailed', 'The changes could not be loaded.')}
      </div>
    )
  }
  // Node headers earn their room once a step touches several nodes.
  const showNodes =
    data.events.length > 1 ||
    data.events.some((event) => event.changes.length === 0)
  return (
    <div className="flex flex-col gap-2">
      {data.events.map((event) => (
        <DiffEvent
          key={event.sequenceNumber}
          event={event}
          showNode={showNodes}
        />
      ))}
      {data.events.length === 0 && (
        <div className="text-neutral-500">
          {t('workspaceHistory.noDetails', 'No details available.')}
        </div>
      )}
    </div>
  )
}

function StepRow({
  workspaceName,
  step,
  expanded,
  onToggle,
  onNavigate,
}: {
  workspaceName: string
  step: WorkspacePendingStep
  expanded: boolean
  onToggle: () => void
  onNavigate: ((address: string) => void) | null
}) {
  const rowRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (expanded) {
      rowRef.current?.scrollIntoView({ block: 'nearest' })
    }
  }, [expanded])
  const document = step.documents[0] ?? null
  return (
    <div
      ref={rowRef}
      className={cn(
        'rounded-sm border border-transparent',
        expanded && 'border-neutral-700 bg-neutral-800/60',
      )}
    >
      <button
        type="button"
        className="flex w-full cursor-pointer items-start gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-neutral-800"
        onClick={onToggle}
      >
        <i
          className={cn(
            'fas fa-fw',
            stepIcon(step),
            'mt-0.5 shrink-0 text-[0.65rem] text-neutral-400',
          )}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-white">{stepSummary(step)}</div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1 text-[10px] text-neutral-500">
            {step.initiatingUserLabel !== null && (
              <span className="truncate">{step.initiatingUserLabel}</span>
            )}
            <span className="shrink-0">
              {step.initiatingUserLabel !== null && '· '}
              {relativeTime(step.recordedAt)}
            </span>
            {document?.label != null && (
              <span className="min-w-0 truncate">
                · <i className="fas fa-file fa-fw text-[0.6rem]" aria-hidden />{' '}
                {document.label}
              </span>
            )}
          </div>
        </div>
        <i
          className={cn(
            'fas fa-chevron-right mt-1 shrink-0 text-[0.55rem] text-neutral-600 transition-transform',
            expanded && 'rotate-90',
          )}
          aria-hidden
        />
      </button>
      {expanded && (
        <div className="border-t border-neutral-800 px-2 py-1.5 text-[11px]">
          <StepDiff workspaceName={workspaceName} step={step} />
          {onNavigate !== null && document?.address != null && (
            <Button
              variant="secondary"
              size="xs"
              className="mt-2"
              onClick={() => onNavigate(document.address!)}
            >
              <i className="fas fa-arrow-right fa-fw" aria-hidden />
              {t('workspaceHistory.goToPage', 'Go to page')}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

export function BranchHistoryPanel({
  branch,
  selectedStepId,
  currentDocumentId,
  onSelectStep,
  onNavigate,
  onClose,
}: {
  branch: WorkspaceBranch
  /** The picked commit dot's step, expanded initially; null = head pick. */
  selectedStepId: number | null
  /** The document open in the preview - target of the "this page" filter. */
  currentDocumentId: string | null
  /** Keeps the graph's dot selection in sync with the expanded step. */
  onSelectStep: (stepId: number | null) => void
  /** Follow a document address into the editing context; null = cannot. */
  onNavigate: ((address: string) => void) | null
  onClose: () => void
}) {
  const [expandedId, setExpandedId] = useState<number | null>(selectedStepId)
  const [documentOnly, setDocumentOnly] = useState(false)
  // A dot pick (from the graph) drives the expansion; row clicks below flow
  // back through onSelectStep, so both stay one state.
  useEffect(() => setExpandedId(selectedStepId), [selectedStepId])

  const steps = useMemo(
    () => branch.dots.map((dot) => dot.step).reverse(),
    [branch],
  )
  const filtered = useMemo(
    () =>
      documentOnly && currentDocumentId !== null
        ? steps.filter((step) =>
            step.documents.some((doc) => doc.id === currentDocumentId),
          )
        : steps,
    [steps, documentOnly, currentDocumentId],
  )

  const workspaceName = branch.workspace.name
  return (
    <div className="absolute top-2 right-2 bottom-2 z-10 flex w-80 flex-col rounded-md border border-neutral-700 bg-neutral-900/95 text-xs shadow-lg backdrop-blur-xs">
      <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2">
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: branch.color }}
        />
        <span className="min-w-0 flex-1 truncate font-medium text-white">
          {t('workspaceHistory.title', 'History')}
          {' · '}
          {branch.workspace.classification === 'ROOT'
            ? t('workspace.live', 'Live')
            : branch.workspace.title || branch.workspace.name}
        </span>
        {currentDocumentId !== null && (
          <Button
            variant={documentOnly ? 'secondary' : 'ghost'}
            size="xs"
            className="shrink-0"
            title={t(
              'workspaceHistory.filterDocumentHint',
              'Only steps that touched the current page',
            )}
            onClick={() => setDocumentOnly((value) => !value)}
          >
            <i className="fas fa-file fa-fw" aria-hidden />
            {t('workspaceHistory.filterDocument', 'This page')}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          className="shrink-0"
          onClick={onClose}
          title={t('workspaceGraph.closeDetails', 'Close details')}
        >
          <i className="fas fa-xmark" aria-hidden />
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-1.5">
        {filtered.length === 0 && (
          <div className="px-2 py-3 text-neutral-500">
            {documentOnly
              ? t(
                  'workspaceHistory.emptyForDocument',
                  'No changes on the current page.',
                )
              : t('workspaceHistory.empty', 'No pending changes.')}
          </div>
        )}
        <div className="flex flex-col gap-0.5">
          {filtered.map((step) => (
            <StepRow
              key={step.id}
              workspaceName={workspaceName}
              step={step}
              expanded={expandedId === step.id}
              onToggle={() => {
                const next = expandedId === step.id ? null : step.id
                setExpandedId(next)
                onSelectStep(next)
              }}
              onNavigate={onNavigate}
            />
          ))}
        </div>
        {branch.truncated && (
          <div className="px-2 py-2 text-center text-[10px] text-neutral-600">
            {branch.workspace.baseWorkspace === null
              ? t(
                  'workspaceHistory.olderRoot',
                  'Older published history is not shown.',
                )
              : t('workspaceHistory.older', 'Older history is not shown.')}
          </div>
        )}
      </div>
    </div>
  )
}
