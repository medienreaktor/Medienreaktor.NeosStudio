import { groupComments, useReviewComments } from '@/api/reviewComments'
import { type Task } from '@/api/tasks'
import { useUsers } from '@/api/users'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  presenceColor,
  presenceInitials,
} from '@/features/collaboration/presenceColors'
import { CommentThread } from '@/features/review/CommentThread'
import { translate as t } from '@/lib/i18n'
import { taskStatusColor, taskStatusLabel } from './status'

/**
 * The read-only task view - what a card click or a notification opens.
 * Shows title, description, assignee and the comment thread (everyone with
 * access to the task workspace can read and join it); acting on the task
 * (checking the workspace out, editing the details) is offered as explicit
 * buttons, so looking at a task never accidentally changes anything.
 */
export function TaskViewDialog({
  task,
  onOpenChange,
  onCheckout,
  onEdit,
}: {
  task: Task | null
  onOpenChange: (open: boolean) => void
  /** Check the task workspace out for direct editing (closes the dialog). */
  onCheckout: (task: Task) => void
  /** Switch over to the edit dialog for this task. */
  onEdit: (task: Task) => void
}) {
  const { data: usersData } = useUsers()

  const canWrite = task?.workspace?.permissions.write ?? false
  const canManage = task?.workspace?.permissions.manage ?? false
  const assigneeLabel = task?.assignee
    ? (usersData?.users.find((user) => user.id === task.assignee)?.label ??
      null)
    : null

  return (
    <Dialog open={task !== null} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        {/* The header carries everything about the task itself - title +
            status, description, assignee, actions; the body below is the
            conversation. The dialog's built-in X closes it. */}
        <DialogHeader className="gap-3 border-b border-neutral-200 dark:border-neutral-800 pb-4">
          <div className="min-w-0 pr-8">
            <DialogTitle className="flex items-center gap-2">
              {task?.workspace?.title || task?.workspaceName}
              {task && (
                <span
                  className="inline-flex items-center rounded-sm border border-current px-1 py-px text-[0.6rem] leading-none font-semibold tracking-wide uppercase select-none"
                  style={{ color: taskStatusColor(task.status) }}
                >
                  {taskStatusLabel(task.status)}
                </span>
              )}
            </DialogTitle>
            {task?.workspace?.description && (
              <DialogDescription className="mt-1 whitespace-pre-line">
                {task.workspace.description}
              </DialogDescription>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div
              className="flex items-center gap-2 text-sm text-neutral-950 dark:text-white"
              title={t('tasks.assignee', 'Assignee')}
            >
              {task?.assignee ? (
                <>
                  <span
                    className="flex size-5 items-center justify-center rounded-full text-[0.55rem] font-semibold text-white select-none"
                    style={{ backgroundColor: presenceColor(task.assignee) }}
                  >
                    {presenceInitials(assigneeLabel ?? '?')}
                  </span>
                  {assigneeLabel ?? task.assignee}
                </>
              ) : (
                <>
                  <span className="flex size-5 items-center justify-center rounded-full bg-neutral-300 dark:bg-neutral-700 text-[0.55rem] text-neutral-600 dark:text-neutral-400 select-none">
                    ?
                  </span>
                  <span className="text-neutral-600 dark:text-neutral-400">
                    {t('tasks.unassignedHint', 'Unassigned')}
                  </span>
                </>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                disabled={!canWrite || task === null}
                onClick={() => task && onCheckout(task)}
              >
                <i className="fas fa-code-branch" aria-hidden />
                {t('tasks.checkoutWorkspace', 'Work on this task')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={!canManage || task === null}
                onClick={() => task && onEdit(task)}
              >
                <i className="fas fa-pen" aria-hidden />
                {t('tasks.editTask', 'Edit task')}
              </Button>
            </div>
          </div>
        </DialogHeader>

        <TaskComments
          workspaceName={task?.workspaceName ?? null}
          canManage={canManage}
        />
      </DialogContent>
    </Dialog>
  )
}

/**
 * The task's conversation - the workspace's general thread (see
 * CommentThread). Remarks pinned to single changes are deliberately not mixed
 * in: without the change next to them they read out of context, so they are
 * only counted here and belong to the compare view.
 */
function TaskComments({
  workspaceName,
  canManage,
}: {
  workspaceName: string | null
  canManage: boolean
}) {
  const { data } = useReviewComments(workspaceName)
  const { general, openByDocument } = groupComments(data?.comments ?? [])
  const pinnedOpen = [...openByDocument.values()].reduce(
    (sum, count) => sum + count,
    0,
  )

  return (
    <div>
      <div className="flex items-center justify-between gap-2 text-xs text-neutral-600 dark:text-neutral-400">
        <span>{t('review.comments', 'Comments')}</span>
        {pinnedOpen > 0 && (
          <span
            className="flex items-center gap-1 text-amber-600 dark:text-amber-400"
            title={t(
              'review.pinnedOpenHint',
              'Open remarks on single changes — they show up in the side-by-side comparison',
            )}
          >
            <i className="fas fa-comment-dots" aria-hidden />
            {pinnedOpen === 1
              ? t('review.onePinnedOpen', '1 open remark on a change')
              : t('review.manyPinnedOpen', '{0} open remarks on changes', [
                  pinnedOpen,
                ])}
          </span>
        )}
      </div>

      {workspaceName !== null && (
        <CommentThread
          className="mt-2"
          listClassName="max-h-64 overflow-y-auto"
          workspaceName={workspaceName}
          comments={general}
          canManage={canManage}
        />
      )}
    </div>
  )
}
