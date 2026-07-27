import {
  useWorkspacePendingEventsDiff,
  type WorkspaceDocumentDiffNode,
  type WorkspacePendingDiffChange,
  type WorkspacePendingDiffEvent,
  type WorkspacePendingStep,
} from '@/api/workspaces'
import { Spinner } from '@/components/ui/spinner'
import { translate as t, translateLabel } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import {
  eventIcon,
  eventTone,
  eventTypeLabel,
  TONE_TEXT_CLASSES,
  type ChangeTone,
} from './historyLabels'

/**
 * The before/after diff of one editing step, lazily fetched from the
 * pending-events diff resource - the rendering the branch history panel and
 * the review dialog share. Per event: which node, then per-property rows
 * with the old value struck out and the new value below.
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

/**
 * One diffed event inside an expanded step: what kind of change it was, on
 * which node, then the changes themselves - the reading order of a log row
 * (kind of edit in its tone first, what was edited after it).
 */
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
        <div className="flex min-w-0 items-center gap-1.5">
          <i
            className={cn(
              'fas fa-fw shrink-0 text-[0.65rem]',
              eventIcon(event.type, event.tag),
              TONE_TEXT_CLASSES[eventTone(event.type, event.tag)],
            )}
            aria-hidden
          />
          <span
            className={cn(
              'shrink-0',
              TONE_TEXT_CLASSES[eventTone(event.type, event.tag)],
            )}
          >
            {eventTypeLabel(event.type, event.tag)}
          </span>
          <span className="truncate text-white">
            {event.nodeLabel ??
              event.nodeAggregateId ??
              t('workspaceGraph.unknownNode', 'Unknown node')}
          </span>
        </div>
      )}
      {event.changes.map((change, index) => (
        <ChangeRow key={index} change={change} />
      ))}
      {event.changes.length === 0 && !showNode && (
        <div className={TONE_TEXT_CLASSES[eventTone(event.type, event.tag)]}>
          {eventTypeLabel(event.type, event.tag)}
        </div>
      )}
    </div>
  )
}

/** Status vocabulary of a net-diff node, in the shared change colors. */
const NODE_STATUS: Record<
  WorkspaceDocumentDiffNode['status'],
  { tone: ChangeTone; icon: string; label: () => string }
> = {
  created: {
    tone: 'add',
    icon: 'fa-plus',
    label: () => t('workspaceGraph.event.nodeCreated', 'Created'),
  },
  removed: {
    tone: 'remove',
    icon: 'fa-trash',
    label: () => t('workspaceGraph.event.nodeRemoved', 'Removed'),
  },
  moved: {
    tone: 'change',
    icon: 'fa-up-down-left-right',
    label: () => t('workspaceGraph.event.nodeMoved', 'Moved'),
  },
  changed: {
    tone: 'change',
    icon: 'fa-pen',
    label: () => t('workspace.badge.changed', 'Changed'),
  },
}

/**
 * One changed node of a document's NET diff (workspace vs base): what kind of
 * change it is (in the change colors) on which node, then the squashed
 * old -> new rows - what publishing this document would apply for this node.
 * Reads like a log row, so the review dialog and the history logs tell their
 * changes the same way.
 */
export function NodeDiff({ node }: { node: WorkspaceDocumentDiffNode }) {
  const status = NODE_STATUS[node.status]
  return (
    <div className="flex flex-col gap-1">
      <div className="flex min-w-0 items-center gap-1.5">
        <i
          className={cn(
            'fas fa-fw shrink-0 text-[0.65rem]',
            status.icon,
            TONE_TEXT_CLASSES[status.tone],
          )}
          aria-hidden
        />
        <span className={cn('shrink-0', TONE_TEXT_CLASSES[status.tone])}>
          {status.label()}
        </span>
        <span className="truncate text-white">
          {node.nodeLabel ??
            node.nodeAggregateId ??
            t('workspaceGraph.unknownNode', 'Unknown node')}
        </span>
      </div>
      {node.changes.map((change, index) => (
        <ChangeRow key={index} change={change} />
      ))}
    </div>
  )
}

/** The lazily fetched before/after body of an expanded step. `documentId`
 * narrows the diff to the events of one document (the review dialog's view
 * onto a step that may span several pages). */
export function StepDiff({
  workspaceName,
  step,
  documentId,
}: {
  workspaceName: string
  step: WorkspacePendingStep
  documentId?: string
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
  const events =
    documentId !== undefined
      ? data.events.filter((event) => event.documentAggregateId === documentId)
      : data.events
  // Node headers earn their room once a step touches several nodes.
  const showNodes =
    events.length > 1 || events.some((event) => event.changes.length === 0)
  return (
    <div className="flex flex-col gap-2">
      {events.map((event) => (
        <DiffEvent
          key={event.sequenceNumber}
          event={event}
          showNode={showNodes}
        />
      ))}
      {events.length === 0 && (
        <div className="text-neutral-500">
          {t('workspaceHistory.noDetails', 'No details available.')}
        </div>
      )}
    </div>
  )
}
