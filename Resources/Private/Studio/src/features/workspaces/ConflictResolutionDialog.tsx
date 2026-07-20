import type { RebaseConflict } from '@/api/workspaces'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/** Icon + past-tense verb per type of change, mirroring the change badges. */
const TYPE_META: Record<
  NonNullable<RebaseConflict['typeOfChange']>,
  { icon: string; verb: string }
> = {
  created: { icon: 'fa-plus', verb: 'added' },
  changed: { icon: 'fa-pen', verb: 'changed' },
  moved: { icon: 'fa-arrows-up-down-left-right', verb: 'moved' },
  deleted: { icon: 'fa-trash-can', verb: 'removed' },
}

function reasonText(conflict: RebaseConflict): string {
  if (conflict.reason === 'node_has_been_deleted') {
    return 'It was deleted in the target workspace since you changed it.'
  }
  return conflict.message
}

/**
 * Presents the conflicts a rebase/publish surfaced and offers the resolutions
 * the content repository actually supports. Purely presentational - the parent
 * wires the actions to its context (sync vs publish) and closes on success.
 *
 * - "Discard conflicting changes" forces the rebase, dropping the listed
 *   changes and keeping the rest (not offered for `partial` conflicts, where
 *   forcing does not help - there the selection itself is the problem).
 * - "Discard all changes" throws the whole set away - the escape hatch.
 */
export function ConflictResolutionDialog({
  open,
  conflicts,
  partial,
  busy,
  onCancel,
  onForce,
  onDiscardAll,
  onNavigate,
}: {
  open: boolean
  conflicts: RebaseConflict[]
  /** True for partial_publish_conflicts, where forcing is not a valid remedy. */
  partial: boolean
  busy: boolean
  onCancel: () => void
  onForce?: () => void
  onDiscardAll?: () => void
  onNavigate?: (documentAddress: string) => void
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onCancel()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>
            {conflicts.length === 1
              ? '1 conflicting change'
              : `${conflicts.length} conflicting changes`}
          </DialogTitle>
          <DialogDescription>
            {partial
              ? 'These changes can’t be published on their own - they depend on other pending changes. Publish everything instead, or discard them.'
              : 'These pending changes conflict with changes already published to the base workspace. Discarding them keeps all your other changes; discarded changes cannot be recovered.'}
          </DialogDescription>
        </DialogHeader>

        <ul className="flex max-h-64 flex-col gap-px overflow-y-auto">
          {conflicts.map((conflict, index) => {
            const meta = conflict.typeOfChange
              ? TYPE_META[conflict.typeOfChange]
              : undefined
            const title =
              conflict.nodeLabel ??
              conflict.documentLabel ??
              conflict.nodeAggregateId ??
              'Unknown node'
            const canNavigate =
              onNavigate !== undefined &&
              conflict.documentAddress !== null &&
              conflict.documentLabel !== null
            return (
              <li
                key={conflict.nodeAggregateId ?? index}
                className="flex items-start gap-3 rounded-sm bg-neutral-800 px-3 py-2"
              >
                <i
                  className={`fas fa-fw ${meta?.icon ?? 'fa-circle-exclamation'} mt-0.5 text-neutral-400`}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-neutral-100">
                    {title}
                    {meta ? (
                      <span className="text-neutral-400"> — {meta.verb}</span>
                    ) : null}
                  </div>
                  <div className="text-xs text-neutral-400">
                    {reasonText(conflict)}
                  </div>
                  {canNavigate ? (
                    <button
                      type="button"
                      className="mt-1 text-xs text-blue-400 hover:underline"
                      onClick={() => onNavigate!(conflict.documentAddress!)}
                    >
                      <i
                        className="fas fa-fw fa-arrow-up-right-from-square"
                        aria-hidden
                      />{' '}
                      {conflict.documentLabel}
                    </button>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>

        <DialogFooter>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          {onDiscardAll ? (
            <Button
              variant={partial ? 'destructive' : 'secondary'}
              onClick={onDiscardAll}
              disabled={busy}
            >
              Discard all changes
            </Button>
          ) : null}
          {!partial && onForce ? (
            <Button variant="destructive" onClick={onForce} disabled={busy}>
              Discard conflicting changes
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
