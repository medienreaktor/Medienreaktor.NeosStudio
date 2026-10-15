import { useMemo } from 'react'
import type { ConflictingChange, NodeAddress } from '@/api/neos/schema'
import { translate as t } from '@/lib/i18n'
import { useConflictDetails } from './historyData'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type ChangeKind = 'created' | 'changed' | 'moved' | 'deleted'

/** Icon + past-tense verb per type of change, mirroring the change badges. */
const TYPE_META: Record<
  ChangeKind,
  { icon: string; verbKey: string; verb: string }
> = {
  created: {
    icon: 'fa-plus',
    verbKey: 'workspace.change.added',
    verb: 'added',
  },
  changed: {
    icon: 'fa-pen',
    verbKey: 'workspace.change.changed',
    verb: 'changed',
  },
  moved: {
    icon: 'fa-arrows-up-down-left-right',
    verbKey: 'workspace.change.moved',
    verb: 'moved',
  },
  deleted: {
    icon: 'fa-trash-can',
    verbKey: 'workspace.change.removed',
    verb: 'removed',
  },
}

/** Neos.Api's typeOfChange ("node_has_been_changed") as a change kind. */
function changeKind(typeOfChange: string | null): ChangeKind | null {
  const kind = (typeOfChange ?? '').replace(/^node_has_been_/, '')
  return kind === 'created' ||
    kind === 'changed' ||
    kind === 'moved' ||
    kind === 'deleted'
    ? kind
    : null
}

/** A conflicting change with the labels and document the Studio resolved for it. */
interface ResolvedConflict extends ConflictingChange {
  nodeLabel: string | null
  documentLabel: string | null
  documentAddress: NodeAddress | null
}

/**
 * The conflicts with their labels and document addresses filled in - Neos.Api
 * names conflicting nodes by id only; the Studio resolves them in the
 * workspace (useConflictDetails). Until that answer arrives (or when it
 * fails) the conflicts come back without them.
 */
function useResolvedConflicts(
  workspaceName: string | null,
  conflicts: ConflictingChange[],
): ResolvedConflict[] {
  const { data: details } = useConflictDetails(
    workspaceName,
    conflicts.flatMap((conflict) =>
      conflict.nodeAggregateId !== null
        ? [
            {
              nodeAggregateId: conflict.nodeAggregateId,
              documentAggregateId: conflict.documentAggregateId,
            },
          ]
        : [],
    ),
  )
  return useMemo(() => {
    const byId = new Map(
      (details ?? []).map((detail) => [detail.nodeAggregateId, detail]),
    )
    return conflicts.map((conflict) => {
      const detail =
        conflict.nodeAggregateId !== null
          ? byId.get(conflict.nodeAggregateId)
          : undefined
      return {
        ...conflict,
        documentAggregateId:
          conflict.documentAggregateId ?? detail?.documentAggregateId ?? null,
        nodeLabel: detail?.nodeLabel ?? null,
        documentLabel: detail?.documentLabel ?? null,
        documentAddress: detail?.documentAddress ?? null,
      }
    })
  }, [conflicts, details])
}

function reasonText(conflict: ConflictingChange): string {
  if (conflict.reason === 'node_has_been_deleted') {
    return t(
      'workspace.conflict.nodeDeleted',
      'It was deleted in the target workspace since you changed it.',
    )
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
  workspaceName,
  conflicts: reportedConflicts,
  partial,
  busy,
  onCancel,
  onForce,
  onDiscardAll,
  onNavigate,
}: {
  open: boolean
  /**
   * The workspace the conflicts belong to - its nodes are looked up to name
   * the conflicts (Neos.Api reports them by id only).
   */
  workspaceName: string | null
  /** Neos.Api's conflicting changes (WorkspaceConflictProblem.conflicts). */
  conflicts: ConflictingChange[]
  /** True for a "partial" conflict problem, where forcing is not a valid remedy. */
  partial: boolean
  busy: boolean
  onCancel: () => void
  onForce?: () => void
  onDiscardAll?: () => void
  onNavigate?: (documentAddress: NodeAddress) => void
}) {
  const conflicts = useResolvedConflicts(
    open ? workspaceName : null,
    reportedConflicts,
  )
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onCancel()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>
            {conflicts.length === 1
              ? t('workspace.conflict.countOne', '1 conflicting change')
              : t('workspace.conflict.countMany', '{0} conflicting changes', [
                  conflicts.length,
                ])}
          </DialogTitle>
          <DialogDescription>
            {partial
              ? t(
                  'workspace.conflict.partialDescription',
                  'These changes can’t be published on their own - they depend on other pending changes. Publish everything instead, or discard them.',
                )
              : t(
                  'workspace.conflict.description',
                  'These pending changes conflict with changes already published to the base workspace. Discarding them keeps all your other changes; discarded changes cannot be recovered.',
                )}
          </DialogDescription>
        </DialogHeader>

        <ul className="flex max-h-64 flex-col gap-px overflow-y-auto">
          {conflicts.map((conflict, index) => {
            const kind = changeKind(conflict.typeOfChange)
            const meta = kind ? TYPE_META[kind] : undefined
            const title =
              conflict.nodeLabel ??
              conflict.documentLabel ??
              conflict.nodeAggregateId ??
              t('workspace.conflict.unknownNode', 'Unknown node')
            const canNavigate =
              onNavigate !== undefined &&
              conflict.documentAddress !== null &&
              conflict.documentLabel !== null
            return (
              <li
                key={conflict.nodeAggregateId ?? index}
                className="flex items-start gap-3 rounded-sm bg-neutral-200 dark:bg-neutral-800 px-3 py-2"
              >
                <i
                  className={`fas fa-fw ${meta?.icon ?? 'fa-circle-exclamation'} mt-0.5 text-neutral-600 dark:text-neutral-400`}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-neutral-900 dark:text-neutral-100">
                    {title}
                    {meta ? (
                      <span className="text-neutral-600 dark:text-neutral-400">
                        {' '}
                        — {t(meta.verbKey, meta.verb)}
                      </span>
                    ) : null}
                  </div>
                  <div className="text-xs text-neutral-600 dark:text-neutral-400">
                    {reasonText(conflict)}
                  </div>
                  {canNavigate ? (
                    <button
                      type="button"
                      className="mt-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
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
            {t('action.cancel', 'Cancel')}
          </Button>
          {onDiscardAll ? (
            <Button
              variant={partial ? 'destructive' : 'secondary'}
              onClick={onDiscardAll}
              disabled={busy}
            >
              {t('workspace.conflict.discardAllChanges', 'Discard all changes')}
            </Button>
          ) : null}
          {!partial && onForce ? (
            <Button variant="destructive" onClick={onForce} disabled={busy}>
              {t(
                'workspace.conflict.discardConflicting',
                'Discard conflicting changes',
              )}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
