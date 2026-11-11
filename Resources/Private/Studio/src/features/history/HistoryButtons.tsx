import type { Node } from '@/api/neos/schema'
import type { WorkspaceRef } from '@/app/events'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { translate as t } from '@/lib/i18n'
import { redo, undo, useHistory } from './historyStore'
import type { HistoryLocation } from './location'

/**
 * The header's undo and redo buttons for the workspace being edited - their
 * titles name the edit they revert or apply again, and its page when that
 * is not the one shown. After either, the preview, trees and inspector are
 * reloaded (onApplied), and the shell goes to where the result is seen
 * (onReveal): the page, with the changed node selected.
 */
export function HistoryButtons({
  workspace,
  document,
  onApplied,
  onReveal,
}: {
  workspace: WorkspaceRef
  /** The document shown. */
  document: Node | null
  onApplied: () => void
  onReveal: (location: HistoryLocation) => void
}) {
  const { undoLabel, undoLocation, redoLabel, redoLocation, running } =
    useHistory(workspace)

  const run = (direction: 'undo' | 'redo') => {
    const action = direction === 'undo' ? undo : redo
    action(workspace)
      .then((location) => {
        onApplied()
        if (location) onReveal(location)
      })
      .catch((error: unknown) => {
        toast.error(error, {
          title:
            direction === 'undo'
              ? t('undo.undoFailed', 'Undo failed')
              : t('undo.redoFailed', 'Redo failed'),
        })
        // Whatever the failed undo/redo wrote before failing is shown too.
        onApplied()
      })
  }

  /**
   * The edit, with its page if that is another one than shown - for content:
   * an edited page is named by the label already.
   */
  const describe = (label: string, location: HistoryLocation | null) =>
    location?.node &&
    location.document.nodeAggregateId !== document?.nodeAggregateId
      ? t('undo.onPage', '{0} (on “{1}”)', [label, location.documentLabel])
      : label

  return (
    <div className="flex items-center">
      <Button
        size="icon"
        variant="ghost"
        disabled={running || undoLabel === null}
        onClick={() => run('undo')}
        title={
          undoLabel === null
            ? t('undo.nothingToUndo', 'Nothing to undo')
            : t('undo.undoAction', 'Undo: {0}', [
                describe(undoLabel, undoLocation),
              ])
        }
        aria-label={t('undo.undo', 'Undo')}
      >
        <i className="fas fa-fw fa-rotate-left" aria-hidden />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        disabled={running || redoLabel === null}
        onClick={() => run('redo')}
        title={
          redoLabel === null
            ? t('undo.nothingToRedo', 'Nothing to redo')
            : t('undo.redoAction', 'Redo: {0}', [
                describe(redoLabel, redoLocation),
              ])
        }
        aria-label={t('undo.redo', 'Redo')}
      >
        <i className="fas fa-fw fa-rotate-right" aria-hidden />
      </Button>
    </div>
  )
}
