import { useEffect, useRef } from 'react'
import { type WorkspacePendingStep } from '@/api/workspaces'
import { UserAvatar } from '@/features/collaboration/UserAvatar'
import { cn } from '@/lib/utils'
import {
  relativeTime,
  stepHasDetails,
  stepIcon,
  stepLabel,
  stepSubject,
  stepTone,
  TONE_TEXT_CLASSES,
} from './historyLabels'
import { StepDiff } from './StepDiff'

/**
 * One editing step of a pending history as a log row: what kind of edit it was,
 * who made it and when, expandable into its before/after diff (lazily fetched
 * from the pending-events diff resource). Shared by every history log - the
 * branch history in the Workspaces graph and the History panel of the page
 * being edited - so they stay one look.
 *
 * Steps without a diff worth showing (hiding, showing, deleting, restoring -
 * see stepHasDetails) have no chevron and unfold into nothing; picking one
 * only selects it, so its row never opens an empty box.
 */
export function HistoryStepRow({
  workspaceName,
  step,
  expanded,
  documentId,
  onToggle,
}: {
  workspaceName: string
  step: WorkspacePendingStep
  /** Selected - and unfolded, for the steps that have something to unfold. */
  expanded: boolean
  /**
   * Scopes the row to one document: the diff then shows only that document's
   * events, and the document line is dropped - in a log of one page every row
   * would repeat its name.
   */
  documentId?: string
  onToggle: () => void
}) {
  const rowRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (expanded) {
      rowRef.current?.scrollIntoView({ block: 'nearest' })
    }
  }, [expanded])
  const document = step.documents[0] ?? null
  const tone = stepTone(step)
  const subject = stepSubject(step)
  const hasDetails = stepHasDetails(step)
  return (
    <div
      ref={rowRef}
      className={cn(
        // Expanded reads as selected, exactly like a selected page in the
        // trees: blue border on the same rounded, slightly lifted surface.
        'rounded-sm border border-transparent',
        expanded && 'border-blue-500 bg-neutral-200 dark:bg-neutral-800',
      )}
    >
      <button
        type="button"
        className="flex w-full cursor-pointer items-start gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-neutral-200 dark:hover:bg-neutral-800"
        onClick={onToggle}
      >
        {/* Icon and label carry the change colors: additions green,
            modifications blue, removals red, dimension variants purple. What
            was edited stays white - the kind of edit is what the color says. */}
        <i
          className={cn(
            'fas fa-fw',
            stepIcon(step),
            'mt-0.5 shrink-0 text-[0.65rem]',
            TONE_TEXT_CLASSES[tone],
          )}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="truncate">
            <span className={TONE_TEXT_CLASSES[tone]}>{stepLabel(step)}</span>
            {subject !== null && (
              <>
                {' '}
                <span className="text-neutral-950 dark:text-white">{subject}</span>
              </>
            )}
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1 text-[10px] text-neutral-500">
            {step.initiatingUserLabel !== null && (
              <>
                <UserAvatar
                  name={step.initiatingUserLabel}
                  userId={step.initiatingUserId}
                  className="size-4 text-[0.5rem]"
                />
                <span className="truncate">{step.initiatingUserLabel}</span>
              </>
            )}
            <span className="shrink-0">
              {step.initiatingUserLabel !== null && '· '}
              {relativeTime(step.recordedAt)}
            </span>
            {documentId === undefined && document?.label != null && (
              <span className="min-w-0 truncate">
                · <i className="fas fa-file fa-fw text-[0.6rem]" aria-hidden />{' '}
                {document.label}
              </span>
            )}
          </div>
        </div>
        {/* The chevron of the inspector groups and the creation surfaces
            (CollapsibleGroup): same glyph, same size, same rotation. */}
        {hasDetails && (
          <i
            className={cn(
              'fas fa-chevron-right mt-0.5 shrink-0 transition-transform',
              expanded && 'rotate-90',
            )}
            aria-hidden
          />
        )}
      </button>
      {expanded && hasDetails && (
        <div className="border-t border-neutral-200 dark:border-neutral-800 px-2 py-1.5 text-[11px]">
          <StepDiff
            workspaceName={workspaceName}
            step={step}
            documentId={documentId}
          />
        </div>
      )}
    </div>
  )
}
