import { useMemo, useState } from 'react'
import {
  groupPendingEvents,
  useWorkspacesPendingEvents,
} from '@/api/workspaces'
import { useStudio } from '@/app/StudioContext'
import { Placeholder } from '@/components/ui/placeholder'
import { LoadingState } from '@/components/ui/spinner'
import { translate as t } from '@/lib/i18n'
import { HistoryStepRow } from './HistoryStepRow'

/**
 * The History panel: the unpublished history of the page being edited, newest
 * first - a git log of this page inside the workspace it is edited in.
 *
 * These are the actual events on the event store, not the squashed net diff
 * the review dialog shows: five edits of one headline are five steps here (the
 * review dialog would show one old -> new row), and an edit that was undone by
 * a later one is still part of the story. Events are grouped into editing
 * steps exactly as the Workspaces graph groups them into commit dots - one
 * command, one step - and rendered with the same row component, so both logs
 * stay one look.
 *
 * The pending history is scoped to the workspace's current content stream,
 * which exists since it last forked off its base: everything listed is
 * unpublished by definition. Publishing, discarding and rebasing swap that
 * stream, so the log empties itself.
 *
 * Live-updating comes for free from the query cache: every write path (and the
 * collaboration bridge, for a colleague's edits in a shared workspace)
 * invalidates the workspaces query prefix, which this history is part of - so
 * another editor's change to the page shows up here within the change feed's
 * poll cadence.
 */
export function HistoryPanel() {
  const { workspaceName, selectedDocument } = useStudio()
  const documentId = selectedDocument?.aggregateId ?? null
  const { byWorkspace, isLoading } = useWorkspacesPendingEvents(
    workspaceName !== null ? [workspaceName] : [],
  )
  const history =
    workspaceName !== null ? byWorkspace.get(workspaceName) : undefined
  const [expandedId, setExpandedId] = useState<number | null>(null)

  // This page's events only, filtered BEFORE grouping: a step's summary, icon
  // and tone then describe what happened to this page, even when the command
  // behind it touched several (a move, a paste across pages).
  const steps = useMemo(() => {
    if (documentId === null) return []
    const events = (history?.events ?? []).filter(
      (event) => event.documentAggregateId === documentId,
    )
    return groupPendingEvents(events).reverse()
  }, [history, documentId])

  if (workspaceName === null || selectedDocument === null || isLoading) {
    return <LoadingState label={t('history.loading', 'Loading the history…')} />
  }
  if (steps.length === 0) {
    return (
      <Placeholder
        icon="fa-clock-rotate-left"
        title={t(
          'history.empty',
          'No unpublished changes on this page. Every edit you make appears here until it is published.',
        )}
      />
    )
  }
  return (
    <div className="flex flex-col gap-0.5 p-1.5 text-xs">
      {steps.map((step) => (
        <HistoryStepRow
          key={step.id}
          workspaceName={workspaceName}
          step={step}
          documentId={selectedDocument.aggregateId}
          expanded={expandedId === step.id}
          onToggle={() =>
            setExpandedId((current) => (current === step.id ? null : step.id))
          }
          // The page is already open - there is nowhere to navigate to.
          onNavigate={null}
        />
      ))}
      {history?.truncated === true && (
        <p className="px-2 py-2 text-center text-[10px] text-neutral-600">
          {t('workspaceHistory.older', 'Older history is not shown.')}
        </p>
      )}
    </div>
  )
}
