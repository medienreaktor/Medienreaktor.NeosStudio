import { useEffect, useMemo, useRef, useState } from 'react'
import { type WorkspacePendingStep } from '@/api/workspaces'
import { Button } from '@/components/ui/button'
import { translate as t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import {
  relativeTime,
  stepIcon,
  stepSummary,
  stepTone,
  TONE_TEXT_CLASSES,
} from './historyLabels'
import { StepDiff } from './StepDiff'
import type { WorkspaceBranch } from './workspaceGraphModel'

/**
 * The history log of one branch in the Workspaces graph: its editing steps
 * newest first - a git log for the workspace. Opens when a head card or a
 * commit dot is picked; a picked dot's step starts expanded. Expanding a step
 * lazily fetches its before/after diff (the pending-events diff resource) and
 * shows, per event, what changed: old value struck out, new value below.
 * "Go to page" follows the step's document into the editing context.
 */

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
            'mt-0.5 shrink-0 text-[0.65rem]',
            // The classic Neos change colors: additions green,
            // modifications orange, removals red.
            TONE_TEXT_CLASSES[stepTone(step)],
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
    // top-12 keeps the panel below the canvas' zoom control cluster, which
    // sits in the top-right corner above it.
    <div className="absolute top-12 right-2 bottom-2 z-10 flex w-80 flex-col rounded-md border border-neutral-700 bg-neutral-900/95 text-xs shadow-lg backdrop-blur-xs">
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
