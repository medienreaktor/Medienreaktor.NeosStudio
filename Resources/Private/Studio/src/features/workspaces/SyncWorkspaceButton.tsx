import { useWorkspaceChanges } from '@/api/workspaces'
import { useStudio } from '@/app/StudioContext'
import { Button } from '@/components/ui/button'
import { translate as t } from '@/lib/i18n'
import { ConflictResolutionDialog } from './ConflictResolutionDialog'
import { useWorkspaceSync } from './useWorkspaceSync'

/**
 * Topbar button that appears when the workspace is OUTDATED - someone
 * published to the base workspace since the last rebase - and synchronizes
 * it (a workspace rebase: incoming changes flow in underneath the own
 * pending ones). When own changes conflict with the incoming ones the rebase
 * fails and the conflict dialog offers to force it (dropping the conflicting
 * changes) or discard the workspace entirely.
 */
export function SyncWorkspaceButton({
  workspaceName,
}: {
  workspaceName: string
}) {
  // Same query the publish button uses; its status field tells us whether
  // the base workspace has moved on.
  const { data: changesResponse } = useWorkspaceChanges(workspaceName)
  const { navigateToNode } = useStudio()
  const { rebase, discardAll, conflicts, clearConflicts, busy } =
    useWorkspaceSync()

  if (changesResponse?.status !== 'OUTDATED') return null

  return (
    <>
      <Button
        size="icon"
        // Only shown while the workspace is outdated - that deserves
        // attention, so it is always orange.
        className="bg-orange-500 text-white hover:bg-orange-500/90"
        disabled={rebase.isPending}
        onClick={() => rebase.mutate({ workspaceName })}
        title={t(
          'workspace.sync.hint',
          'Others published changes to the base workspace. Synchronize to pull them into this workspace.',
        )}
        aria-label={t('workspace.sync.action', 'Synchronize')}
      >
        <i
          className={`fas fa-fw fa-rotate ${rebase.isPending ? 'fa-spin' : ''}`}
          aria-hidden
        />
      </Button>

      <ConflictResolutionDialog
        open={conflicts !== null}
        conflicts={conflicts?.conflicts ?? []}
        partial={conflicts?.code === 'partial_publish_conflicts'}
        busy={busy}
        onCancel={clearConflicts}
        onForce={() =>
          conflicts &&
          rebase.mutate({
            workspaceName: conflicts.workspaceName,
            strategy: 'force',
          })
        }
        onDiscardAll={() =>
          conflicts && discardAll.mutate(conflicts.workspaceName)
        }
        onNavigate={(address) => {
          clearConflicts()
          navigateToNode(address)
        }}
      />
    </>
  )
}
