import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { rebaseWorkspace, useWorkspaceChanges } from '@/api/workspaces'
import { ApiError } from '@/api/client'
import { queryKeys } from '@/api/keys'
import { queryClient } from '@/app/queryClient'
import { useStudio } from '@/app/StudioContext'
import { toast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

function isRebaseConflict(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    typeof error.body === 'object' &&
    error.body !== null &&
    (error.body as { error?: string }).error === 'rebase_conflicts'
  )
}

/**
 * Topbar button that appears when the workspace is OUTDATED - someone
 * published to the base workspace since the last rebase - and synchronizes
 * it (a workspace rebase: incoming changes flow in underneath the own
 * pending ones). When own changes conflict with the incoming ones the rebase
 * fails and a dialog offers to force it, which discards the conflicting own
 * changes.
 */
export function SyncWorkspaceButton({
  workspaceName,
}: {
  workspaceName: string
}) {
  // Same query the publish button uses; its status field tells us whether
  // the base workspace has moved on.
  const { data: changesResponse } = useWorkspaceChanges(workspaceName)
  const { workspaceContentChanged } = useStudio()
  const [conflictDialogOpen, setConflictDialogOpen] = useState(false)

  const rebase = useMutation({
    mutationFn: (strategy?: 'force') =>
      rebaseWorkspace(workspaceName, strategy),
    onSuccess: () => {
      // The rebase rewrote the workspace's content stream: the status flag,
      // every cached node read and all loaded tree items are stale now.
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.nodes.all })
      workspaceContentChanged()
      setConflictDialogOpen(false)
      toast.success('Workspace synchronized.')
    },
    onError: (error) => {
      // Conflicts aren't a failure — they route to the force-discard dialog.
      if (isRebaseConflict(error)) setConflictDialogOpen(true)
      else toast.error(error, { title: 'Synchronizing failed' })
    },
  })

  if (changesResponse?.status !== 'OUTDATED') return null

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

      <Dialog open={conflictDialogOpen} onOpenChange={setConflictDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Conflicting changes</DialogTitle>
            <DialogDescription>
              Some of your pending changes conflict with changes that were
              published to the base workspace. To synchronize anyway, your
              conflicting changes have to be discarded. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => setConflictDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={rebase.isPending}
              onClick={() => rebase.mutate('force')}
            >
              Discard conflicting changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
