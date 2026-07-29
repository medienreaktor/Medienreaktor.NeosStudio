import { type Task, type TaskStatus } from '@/api/tasks'
import { useUsers } from '@/api/users'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  presenceColor,
  presenceInitials,
} from '@/features/collaboration/presenceColors'
import { translate as t } from '@/lib/i18n'
import { taskStatusColor } from './status'

function statusLabel(status: TaskStatus): string {
  switch (status) {
    case 'DONE':
      return t('tasks.statusDone', 'done')
    case 'IN_REVIEW':
      return t('tasks.statusInReview', 'in review')
    default:
      return t('tasks.statusOpen', 'open')
  }
}

/**
 * The read-only task view - what a card click or a notification opens.
 * Shows title, description and assignee; acting on the task (checking the
 * workspace out, editing the details) is offered as explicit buttons, so
 * looking at a task never accidentally changes anything.
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
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {task?.workspace?.title || task?.workspaceName}
            {task && (
              <span
                className="inline-flex items-center rounded-sm border border-current px-1 py-px text-[0.6rem] leading-none font-semibold tracking-wide uppercase select-none"
                style={{ color: taskStatusColor(task.status) }}
              >
                {statusLabel(task.status)}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {task?.workspace?.description && (
            <p className="text-sm whitespace-pre-line text-neutral-300">
              {task.workspace.description}
            </p>
          )}

          <div>
            <div className="text-xs text-neutral-400">
              {t('tasks.assignee', 'Assignee')}
            </div>
            <div className="mt-1 flex items-center gap-2 text-sm text-white">
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
                  <span className="flex size-5 items-center justify-center rounded-full bg-neutral-700 text-[0.55rem] text-neutral-400 select-none">
                    ?
                  </span>
                  <span className="text-neutral-400">
                    {t('tasks.unassignedHint', 'Unassigned')}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="items-center">
          <Button
            type="button"
            className="mr-auto"
            disabled={!canWrite || task === null}
            onClick={() => task && onCheckout(task)}
          >
            <i className="fas fa-code-branch" aria-hidden />
            {t('tasks.checkoutWorkspace', 'Checkout workspace')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
          >
            {t('common.close', 'Close')}
          </Button>
          <Button
            type="button"
            disabled={!canManage || task === null}
            onClick={() => task && onEdit(task)}
          >
            <i className="fas fa-pen" aria-hidden />
            {t('tasks.editTask', 'Edit task')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
