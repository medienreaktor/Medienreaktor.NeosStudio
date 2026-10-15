import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { apiErrorDescription } from '@/api/http/errors'
import { useActiveContentRepositoryId } from '@/api/neos/activeContentRepository'
import { transitionTask } from '@/api/studio/endpoints/tasks'
import { studioKeys } from '@/api/studio/keys'
import type { TaskStatus } from '@/api/studio/schema'
import { queryClient } from '@/app/queryClient'
import { toast } from '@/components/ui/toast'
import { invalidateWorkspaceQueries } from '@/features/workspaces/invalidate'
import { translate as t } from '@/lib/i18n'

/** A status change of the task whose branch the workspace is. */
interface TaskTransition {
  workspaceName: string
  target: TaskStatus
  /** For the reviewers, when submitting. */
  comment?: string
}

function transitionToast(target: TaskStatus): string {
  return target === 'IN_REVIEW'
    ? t('tasks.submitted', 'The task has been submitted for review.')
    : target === 'DONE'
      ? t('tasks.completed', 'The task has been completed.')
      : t('tasks.reopenedToast', 'The task has been reopened.')
}

/**
 * Moving a task through its workflow - submit, reopen, complete - shared by
 * the Tasks board and the task actions of the workspace switcher, so both
 * report and refresh the same way.
 *
 * Completing does NOT publish blindly: while the task workspace has pending
 * changes, `complete` only marks it for review (`reviewing`) - the caller
 * opens the Review Changes dialog on it, the reviewer picks what to publish,
 * and `published` completes the task once that publish went through. With
 * nothing pending the task completes directly.
 */
export function useTaskTransition() {
  const contentRepositoryId = useActiveContentRepositoryId()
  // The task workspace under review before it completes
  const [reviewing, setReviewing] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: ({ workspaceName, target, comment }: TaskTransition) =>
      transitionTask(contentRepositoryId!, workspaceName, target, comment),
    onSuccess: (_response, { target }) =>
      toast.success(transitionToast(target)),
    onError: (error) =>
      toast.error(
        apiErrorDescription(
          error,
          t('tasks.moveFailedDetail', 'Moving the task failed.'),
        ),
        { title: t('tasks.moveFailed', 'Could not move task') },
      ),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: studioKeys.tasks.all })
      void invalidateWorkspaceQueries()
    },
  })

  const complete = (workspace: {
    name: string
    hasPublishableChanges: boolean
  }) => {
    if (workspace.hasPublishableChanges) setReviewing(workspace.name)
    else mutation.mutate({ workspaceName: workspace.name, target: 'DONE' })
  }

  /** The Review Changes dialog published: completes the task under review. */
  const published = (sourceWorkspaceName: string) => {
    if (reviewing === null || sourceWorkspaceName !== reviewing) return
    mutation.mutate({ workspaceName: reviewing, target: 'DONE' })
    setReviewing(null)
  }

  return {
    transition: mutation.mutate,
    isPending: mutation.isPending,
    complete,
    reviewing,
    cancelReview: () => setReviewing(null),
    published,
  }
}
