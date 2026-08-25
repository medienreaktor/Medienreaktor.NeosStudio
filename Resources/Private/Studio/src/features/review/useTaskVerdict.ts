import { useMutation } from '@tanstack/react-query'
import { queryKeys } from '@/api/keys'
import { taskOf, transitionTask, type TaskExtension } from '@/api/tasks'
import type { Workspace } from '@/api/workspaces'
import { queryClient } from '@/app/queryClient'
import { toast } from '@/components/ui/toast'
import { translate as t } from '@/lib/i18n'

/**
 * The verdict a review can hand down on a task branch: approve it (complete
 * the task) or send it back with what needs doing.
 *
 * Shared by the change list and the side-by-side comparison, because a
 * reviewer decides from whichever of the two they happen to be looking at, and
 * the two must not answer differently. A workspace that is no task branch
 * yields `task: null` - a plain draft has no workflow to move, only changes to
 * publish.
 */
export function useTaskVerdict(workspace: Workspace | null): {
  task: TaskExtension | null
  isPending: boolean
  /** Hand the task back to its author; the reason joins its comment thread. */
  requestChanges: (reason: string, onSuccess?: () => void) => void
  /** Mark the task done - what an approval does once its changes went out. */
  complete: (onSuccess?: () => void) => void
} {
  const workspaceName = workspace?.name ?? ''
  const task = workspace ? taskOf(workspace) : null

  const mutation = useMutation({
    mutationFn: ({ target, note }: { target: 'OPEN' | 'DONE'; note?: string }) =>
      transitionTask(workspaceName, target, note),
    onSuccess: (_response, { target }) =>
      toast.success(
        target === 'DONE'
          ? t('tasks.completed', 'The task has been completed.')
          : t('review.changesRequested', 'The task went back to its author.'),
      ),
    onError: (error) =>
      toast.error(error, {
        title: t('review.verdictFailed', 'The task could not be updated'),
      }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks })
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all })
      // Reopening writes the reason into the thread - it has to show up
      // without waiting for the next poll.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.workspaces.comments(workspaceName),
      })
    },
  })

  return {
    task,
    isPending: mutation.isPending,
    requestChanges: (reason, onSuccess) =>
      mutation.mutate({ target: 'OPEN', note: reason }, { onSuccess }),
    complete: (onSuccess) => mutation.mutate({ target: 'DONE' }, { onSuccess }),
  }
}
