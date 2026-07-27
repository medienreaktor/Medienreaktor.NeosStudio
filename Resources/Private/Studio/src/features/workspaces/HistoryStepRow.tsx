import { useEffect, useRef } from 'react'
import { type WorkspacePendingStep } from '@/api/workspaces'
import { Button } from '@/components/ui/button'
import { UserAvatar } from '@/features/collaboration/UserAvatar'
import { translate as t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import {
  relativeTime,
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
 */
export function HistoryStepRow({
  workspaceName,
  step,
  expanded,
  documentId,
  onToggle,
  onNavigate,
}: {
  workspaceName: string
  step: WorkspacePendingStep
  expanded: boolean
  /**
   * Scopes the row to one document: the diff then shows only that document's
   * events, and the document line is dropped - in a log of one page every row
   * would repeat its name.
   */
  documentId?: string
  onToggle: () => void
  /** Follow the step's document into the editing context; null = cannot. */
  onNavigate: ((address: string) => void) | null
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
  return (
    <div
      ref={rowRef}
      className={cn(
        // Expanded reads as selected, exactly like a selected page in the
        // trees: blue border on the same rounded, slightly lifted surface.
        'rounded-sm border border-transparent',
        expanded && 'border-blue-500 bg-neutral-800',
      )}
    >
      <button
        type="button"
        className="flex w-full cursor-pointer items-start gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-neutral-800"
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
                <span className="text-white">{subject}</span>
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
        <i
          className={cn(
            'fas fa-chevron-right mt-0.5 shrink-0 transition-transform',
            expanded && 'rotate-90',
          )}
          aria-hidden
        />
      </button>
      {expanded && (
        <div className="border-t border-neutral-800 px-2 py-1.5 text-[11px]">
          <StepDiff
            workspaceName={workspaceName}
            step={step}
            documentId={documentId}
          />
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
