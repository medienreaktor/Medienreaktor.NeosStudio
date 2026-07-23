import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { ApiError } from '@/api/client'
import {
  changeBaseWorkspace,
  discardWorkspace,
  getRebaseConflicts,
  rebaseWorkspace,
  type RebaseConflicts,
} from '@/api/workspaces'
import { queryKeys } from '@/api/keys'
import { queryClient } from '@/app/queryClient'
import { useStudio } from '@/app/StudioContext'
import { toast } from '@/components/ui/toast'
import { translate as t } from '@/lib/i18n'

/** A failed rebase's conflicts, remembering which workspace they belong to
 * (callers can sync any workspace, not just the active one). */
export interface SyncConflicts extends RebaseConflicts {
  workspaceName: string
}

/**
 * Rebasing a workspace, shared between the topbar SyncWorkspaceButton and
 * the Workspaces graph's card menu: the rebase onto the current base
 * (synchronize), the rebase onto a different base (changeBase) and the
 * discard-everything escape hatch, conflict routing (a rebase rejected with
 * conflicts is not a failure - it surfaces as `conflicts` for the
 * ConflictResolutionDialog), success/error toasts, and cache invalidation.
 *
 * Invalidation is scoped: the workspace list (status flags, pending events)
 * always refreshes; node caches, trees and the preview only when the synced
 * workspace is the active editing context - rebasing someone else's branch
 * from the graph must not reload the page being edited.
 */
export function useWorkspaceSync() {
  const { workspaceName: activeWorkspaceName, workspaceContentChanged } =
    useStudio()
  const [conflicts, setConflicts] = useState<SyncConflicts | null>(null)

  const invalidateWorkspace = (workspaceName: string) => {
    // The rebase/discard rewrote the workspace's content stream: the status
    // flag and its pending events are stale in any case; node reads and tree
    // items only matter for the workspace being edited.
    void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all })
    if (workspaceName === activeWorkspaceName) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.nodes.all })
      workspaceContentChanged()
    }
  }

  const rebase = useMutation({
    mutationFn: ({
      workspaceName,
      strategy,
    }: {
      workspaceName: string
      strategy?: 'force'
    }) => rebaseWorkspace(workspaceName, strategy),
    onSuccess: (_, { workspaceName }) => {
      invalidateWorkspace(workspaceName)
      setConflicts(null)
      toast.success(t('workspace.sync.success', 'Workspace synchronized.'))
    },
    onError: (error, { workspaceName }) => {
      // Conflicts aren't a failure - they route to the resolution dialog.
      const conflict = getRebaseConflicts(error)
      if (conflict) setConflicts({ ...conflict, workspaceName })
      else
        toast.error(error, {
          title: t('workspace.sync.failed', 'Synchronizing failed'),
        })
    },
  })

  /**
   * Rebase onto a DIFFERENT base workspace - "switching the workspace" in
   * Neos terms: editing stays in the workspace, only where it publishes to
   * changes. The content repository requires the workspace to be clean; the
   * 409 for a dirty one gets a friendlier message than the raw server text.
   */
  const changeBase = useMutation({
    mutationFn: ({
      workspaceName,
      baseWorkspace,
    }: {
      workspaceName: string
      baseWorkspace: string
    }) => changeBaseWorkspace(workspaceName, baseWorkspace),
    onSuccess: (_, { workspaceName }) => {
      invalidateWorkspace(workspaceName)
      toast.success(t('workspace.baseChanged', 'Base workspace changed.'))
    },
    onError: (error) => {
      const notEmpty =
        error instanceof ApiError &&
        error.status === 409 &&
        (error.body as { error?: string } | null)?.error ===
          'workspace_not_empty'
      toast.error(
        notEmpty
          ? t(
              'workspace.baseChangeNotEmpty',
              'The workspace still has pending changes - publish or discard them before rebasing it onto another workspace.',
            )
          : error,
        {
          title: t('workspace.switchFailed', 'Switching the workspace failed'),
        },
      )
    },
  })

  const discardAll = useMutation({
    mutationFn: (workspaceName: string) => discardWorkspace(workspaceName),
    onSuccess: (_, workspaceName) => {
      invalidateWorkspace(workspaceName)
      setConflicts(null)
      toast.success(t('workspace.discard.success', 'Changes discarded.'))
    },
    onError: (error) => {
      setConflicts(null)
      toast.error(error, {
        title: t('workspace.discard.failed', 'Discarding failed'),
      })
    },
  })

  return {
    rebase,
    changeBase,
    discardAll,
    conflicts,
    clearConflicts: () => setConflicts(null),
    busy: rebase.isPending || changeBase.isPending || discardAll.isPending,
  }
}
