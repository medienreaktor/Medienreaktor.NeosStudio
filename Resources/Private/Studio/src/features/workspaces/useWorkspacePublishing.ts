import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  canPublish,
  discardWorkspace,
  publishWorkspace,
  rebaseWorkspace,
  workspaceConflicts,
} from '@/api/neos/endpoints/workspaces'
import { useActiveContentRepositoryId } from '@/api/neos/activeContentRepository'
import type {
  Workspace,
  WorkspaceConflictProblem,
  WorkspacePublish,
} from '@/api/neos/schema'
import { neosKeys } from '@/api/neos/keys'
import { queryClient } from '@/app/queryClient'
import { useStudioActions } from '@/app/StudioContext'
import { toast } from '@/components/ui/toast'
import { allowsPublishToLive } from '@/features/access/rules'
import { useAccess } from '@/features/access/useAccess'
import { afterWorkspaceRewrite } from '@/features/workspaces/invalidate'
import { translate as t } from '@/lib/i18n'

/**
 * Whether the account may publish `workspace` into its base. Two gates: the
 * content repository's own (canPublish = write on the base - for live that is
 * what the Neos.Neos:LivePublisher role grants) and the Studio access role's
 * "may publish to live", which restricts root bases only -
 * publishing into a shared review workspace stays open to editors who may not
 * go live themselves. Reviewing needs neither.
 */
export function useCanPublish(
  workspace: Workspace | null,
  workspaces: Workspace[],
): boolean {
  const access = useAccess()
  if (!workspace || !canPublish(workspace, workspaces)) return false
  const publishesToRoot =
    workspaces.find(
      (candidate) => candidate.name === workspace.baseWorkspaceName,
    )?.classification === 'root'
  return !publishesToRoot || allowsPublishToLive(access)
}

/**
 * A publish/discard, optionally scoped to a site or documents (Neos.Api's
 * WorkspacePublish, which a discard takes alike); no scope = the whole
 * workspace.
 */
interface WorkspaceOperation {
  kind: 'publish' | 'discard'
  scope?: WorkspacePublish
}

/**
 * The publish/discard machinery behind the Review changes dialog (opened from
 * the topbar's Publish and review button, the Workspaces graph and the Tasks
 * board): the operation mutation, the conflict it may surface,
 * and the follow-up resolution. Keeping it in one place means both entry points
 * invalidate the same caches and route conflicts to the same dialog - the
 * single source of truth for "what a publish does".
 *
 * A publish that collides with the base workspace is not reported as a plain
 * error; it lands in `pendingConflict` for the caller to render a
 * ConflictResolutionDialog. Everything else is a toast.
 */
export function useWorkspacePublishing(workspaceName: string) {
  const { workspaceContentChanged } = useStudioActions()
  const contentRepositoryId = useActiveContentRepositoryId()
  // A publish that hit a conflict, plus the operation that triggered it (so the
  // resolution can retry it). The conflict dialog is open while set.
  const [pendingConflict, setPendingConflict] = useState<{
    conflicts: WorkspaceConflictProblem
    op: WorkspaceOperation
  } | null>(null)

  const invalidateWorkspace = () => {
    // The changes queries (badges, counts), the workspace list's
    // hasPublishableChanges flag - and the node reads: publishing rebases the
    // workspace onto the new base (changes published by others flow in) and
    // discarding rewrites its content, so they are stale either way, and
    // every loaded tree item needs a re-read (per-item caches in the trees
    // never expire on their own).
    void afterWorkspaceRewrite(contentRepositoryId!, workspaceName)
    workspaceContentChanged()
  }

  const operation = useMutation({
    mutationFn: async (op: WorkspaceOperation): Promise<void> => {
      if (op.kind === 'publish')
        await publishWorkspace(contentRepositoryId!, workspaceName, op.scope)
      else await discardWorkspace(contentRepositoryId!, workspaceName, op.scope)
    },
    onSuccess: (_data, op) => {
      invalidateWorkspace()
      // A publish also changed the base workspace's content (e.g. live):
      // afterWorkspaceRewrite only covers this workspace's node reads.
      if (op.kind === 'publish') {
        void queryClient.invalidateQueries({ queryKey: neosKeys.nodes.all })
      }
      toast.success(
        op.kind === 'discard'
          ? t('workspace.discard.success', 'Changes discarded.')
          : t('workspace.changesPublished', 'Changes published.'),
      )
    },
    onError: (error, op) => {
      // A publish that collides with the base is not a plain failure - route it
      // to the resolution dialog. Everything else is a toast.
      const conflicts = workspaceConflicts(error)
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
        await discardWorkspace(
          contentRepositoryId!,
          workspaceName,
          pendingConflict?.op.scope,
        )
        return
      }
      await rebaseWorkspace(contentRepositoryId!, workspaceName, 'force')
      // Retry the publish now that the conflicting changes are gone. If nothing
      // is left to publish (they were all conflicting), that is success, not an
      // error - only a fresh conflict is worth re-surfacing.
      try {
        await publishWorkspace(
          contentRepositoryId!,
          workspaceName,
          pendingConflict?.op.scope,
        )
      } catch (error) {
        if (workspaceConflicts(error)) throw error
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
      const conflicts = workspaceConflicts(error)
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
