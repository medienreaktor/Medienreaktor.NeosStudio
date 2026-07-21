import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  discardWorkspace,
  getRebaseConflicts,
  publishWorkspace,
  rebaseWorkspace,
  type RebaseConflicts,
  type WorkspaceOperationFilter,
} from '@/api/workspaces'
import { queryKeys } from '@/api/keys'
import { queryClient } from '@/app/queryClient'
import { useStudio } from '@/app/StudioContext'
import { toast } from '@/components/ui/toast'
import { translate as t } from '@/lib/i18n'

/** A publish/discard, optionally scoped; no filter = the whole workspace. */
export interface WorkspaceOperation {
  kind: 'publish' | 'discard'
  filter?: WorkspaceOperationFilter
}

/**
 * The publish/discard machinery shared by the Publish split button and the
 * Review changes dialog: the operation mutation, the conflict it may surface,
 * and the follow-up resolution. Keeping it in one place means both entry points
 * invalidate the same caches and route conflicts to the same dialog - the
 * single source of truth for "what a publish does".
 *
 * A publish that collides with the base workspace is not reported as a plain
 * error; it lands in `pendingConflict` for the caller to render a
 * ConflictResolutionDialog. Everything else is a toast.
 */
export function useWorkspacePublishing(workspaceName: string) {
  const { workspaceContentChanged } = useStudio()
  // A publish that hit a conflict, plus the operation that triggered it (so the
  // resolution can retry it). The conflict dialog is open while set.
  const [pendingConflict, setPendingConflict] = useState<{
    conflicts: RebaseConflicts
    op: WorkspaceOperation
  } | null>(null)

  const invalidateWorkspace = () => {
    // Covers the changes queries (badges, counts) and the workspace list's
    // hasPublishableChanges flag.
    void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all })
    // Publishing rebases the workspace onto the new base (changes published by
    // others flow in) and discarding rewrites its content - cached node reads
    // are stale either way, and every loaded tree item needs a re-read
    // (per-item caches in the trees never expire on their own).
    void queryClient.invalidateQueries({ queryKey: queryKeys.nodes.all })
    workspaceContentChanged()
  }

  const operation = useMutation({
    mutationFn: async (op: WorkspaceOperation): Promise<void> => {
      if (op.kind === 'publish')
        await publishWorkspace(workspaceName, op.filter)
      else await discardWorkspace(workspaceName, op.filter)
    },
    onSuccess: (_data, op) => {
      invalidateWorkspace()
      toast.success(
        op.kind === 'discard'
          ? t('workspace.discard.success', 'Changes discarded.')
          : t('workspace.changesPublished', 'Changes published.'),
      )
    },
    onError: (error, op) => {
      // A publish that collides with the base is not a plain failure - route it
      // to the resolution dialog. Everything else is a toast.
      const conflicts = getRebaseConflicts(error)
      if (conflicts && op.kind === 'publish') {
        setPendingConflict({ conflicts, op })
        return
      }
      toast.error(error, {
        title:
          op.kind === 'discard'
            ? t('workspace.discard.failed', 'Discarding failed')
            : t('workspace.publishing.failed', 'Publishing failed'),
      })
    },
  })

  // Resolves a publish conflict: "force" drops the conflicting changes (a
  // forced rebase) and retries the original publish; "discardAll" throws the
  // scope's changes away. Another conflict on retry re-opens the dialog.
  const resolve = useMutation({
    mutationFn: async (action: 'force' | 'discardAll'): Promise<void> => {
      if (action === 'discardAll') {
        await discardWorkspace(workspaceName, pendingConflict?.op.filter)
        return
      }
      await rebaseWorkspace(workspaceName, 'force')
      // Retry the publish now that the conflicting changes are gone. If nothing
      // is left to publish (they were all conflicting), that is success, not an
      // error - only a fresh conflict is worth re-surfacing.
      try {
        await publishWorkspace(workspaceName, pendingConflict?.op.filter)
      } catch (error) {
        if (getRebaseConflicts(error)) throw error
      }
    },
    onSuccess: (_data, action) => {
      invalidateWorkspace()
      setPendingConflict(null)
      toast.success(
        action === 'discardAll'
          ? t('workspace.discard.success', 'Changes discarded.')
          : t(
              'workspace.conflict.resolvedPublished',
              'Conflicting changes discarded; the rest was published.',
            ),
      )
    },
    onError: (error) => {
      const conflicts = getRebaseConflicts(error)
      if (conflicts && pendingConflict) {
        setPendingConflict({ conflicts, op: pendingConflict.op })
        return
      }
      setPendingConflict(null)
      toast.error(error, {
        title: t(
          'workspace.conflict.resolveFailed',
          'Resolving conflicts failed',
        ),
      })
    },
  })

  return { operation, resolve, pendingConflict, setPendingConflict }
}
