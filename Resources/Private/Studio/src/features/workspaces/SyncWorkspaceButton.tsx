import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  discardWorkspace,
  getRebaseConflicts,
  rebaseWorkspace,
  useWorkspaceChanges,
  type RebaseConflicts,
} from '@/api/workspaces'
import { queryKeys } from '@/api/keys'
import { queryClient } from '@/app/queryClient'
import { useStudio } from '@/app/StudioContext'
import { toast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { ConflictResolutionDialog } from './ConflictResolutionDialog'

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
  const { workspaceContentChanged, navigateToNode } = useStudio()
  const [conflicts, setConflicts] = useState<RebaseConflicts | null>(null)

  const invalidateWorkspace = () => {
    // The rebase/discard rewrote the workspace's content stream: the status
    // flag, every cached node read and all loaded tree items are stale now.
    void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all })
    void queryClient.invalidateQueries({ queryKey: queryKeys.nodes.all })
    workspaceContentChanged()
  }

  const rebase = useMutation({
    mutationFn: (strategy?: 'force') =>
      rebaseWorkspace(workspaceName, strategy),
    onSuccess: () => {
      invalidateWorkspace()
      setConflicts(null)
      toast.success('Workspace synchronized.')
    },
    onError: (error) => {
      // Conflicts aren't a failure - they route to the resolution dialog.
      const conflict = getRebaseConflicts(error)
      if (conflict) setConflicts(conflict)
      else toast.error(error, { title: 'Synchronizing failed' })
    },
  })

  const discardAll = useMutation({
    mutationFn: () => discardWorkspace(workspaceName),
    onSuccess: () => {
      invalidateWorkspace()
      setConflicts(null)
      toast.success('Changes discarded.')
    },
    onError: (error) => {
      setConflicts(null)
      toast.error(error, { title: 'Discarding failed' })
    },
  })

  if (changesResponse?.status !== 'OUTDATED') return null

  const busy = rebase.isPending || discardAll.isPending

  return (
    <>
      <Button
        variant="secondary"
        disabled={rebase.isPending}
        onClick={() => rebase.mutate(undefined)}
        title="Others published changes to the base workspace. Synchronize to pull them into this workspace."
      >
        <i
          className={`fas fa-fw fa-rotate ${rebase.isPending ? 'fa-spin' : ''}`}
          aria-hidden
        />
        Synchronize
      </Button>

      <ConflictResolutionDialog
        open={conflicts !== null}
        conflicts={conflicts?.conflicts ?? []}
        partial={conflicts?.code === 'partial_publish_conflicts'}
        busy={busy}
        onCancel={() => setConflicts(null)}
        onForce={() => rebase.mutate('force')}
        onDiscardAll={() => discardAll.mutate()}
        onNavigate={(address) => {
          setConflicts(null)
          navigateToNode(address)
        }}
      />
    </>
  )
}
