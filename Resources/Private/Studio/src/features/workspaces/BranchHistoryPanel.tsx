import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { translate as t } from '@/lib/i18n'
import { HistoryStepRow } from './HistoryStepRow'
import type { WorkspaceBranch } from './workspaceGraphModel'

/**
 * The history log of one branch in the Workspaces graph: its editing steps
 * newest first - a git log for the workspace. Opens when a head card or a
 * commit dot is picked; a picked dot's step starts expanded. Expanding a step
 * lazily fetches its before/after diff (its events with include=diff) and
 * shows, per event, what changed: old value struck out, new value below.
 */

export function BranchHistoryPanel({
  branch,
  selectedStepId,
  onSelectStep,
  onClose,
}: {
  branch: WorkspaceBranch
  /** The picked commit dot's step, the one expanded; null = head pick. */
  selectedStepId: number | null
  /** Selects (expands) a step - the graph's dot selection is the state. */
  onSelectStep: (stepId: number | null) => void
  onClose: () => void
}) {
  const steps = useMemo(
    () => branch.dots.map((dot) => dot.step).reverse(),
    [branch],
  )

  const workspaceName = branch.workspace.name
  return (
    // top-12 keeps the panel below the canvas' zoom control cluster, which
    // sits in the top-right corner above it.
    <div className="absolute top-12 right-2 bottom-2 z-10 flex w-80 flex-col rounded-md border border-neutral-300 dark:border-neutral-700 bg-neutral-50/95 dark:bg-neutral-900/95 text-xs shadow-lg backdrop-blur-xs">
      {/* Which branch this is, is said by the card the pick came from - the
          heading only names what the pane lists. */}
      <div className="flex items-center gap-2 border-b border-neutral-200 dark:border-neutral-800 px-3 py-2">
        <span className="min-w-0 flex-1 truncate font-medium text-neutral-950 dark:text-white">
          {t('workspaceHistory.events', 'Events')}
        </span>
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
        {steps.length === 0 && (
          <div className="px-2 py-3 text-neutral-500">
            {t('workspaceHistory.empty', 'No pending changes.')}
          </div>
        )}
        <div className="flex flex-col gap-0.5">
          {steps.map((step) => (
            <HistoryStepRow
              key={step.id}
              workspaceName={workspaceName}
              step={step}
              expanded={selectedStepId === step.id}
              onToggle={() =>
                onSelectStep(selectedStepId === step.id ? null : step.id)
              }
            />
          ))}
        </div>
        {branch.truncated && (
          <div className="px-2 py-2 text-center text-[10px] text-neutral-400 dark:text-neutral-600">
            {branch.workspace.baseWorkspaceName === null
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
