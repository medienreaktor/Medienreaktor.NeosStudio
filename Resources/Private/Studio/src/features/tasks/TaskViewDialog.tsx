import { useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { apiErrorDescription } from '@/api/client'
import { queryKeys } from '@/api/keys'
import {
  addTaskComment,
  useTaskComments,
  type Task,
  type TaskStatus,
} from '@/api/tasks'
import { useUsers } from '@/api/users'
import { queryClient } from '@/app/queryClient'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/components/ui/toast'
import {
  presenceColor,
  presenceInitials,
} from '@/features/collaboration/presenceColors'
import { translate as t } from '@/lib/i18n'
import { taskStatusColor } from './status'

/** "5 min ago"-style timestamp; older than a week reads as a plain date. */
function timeAgo(iso: string): string {
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  if (seconds < 60) return format.format(0, 'minute')
  if (seconds < 3600) return format.format(-Math.floor(seconds / 60), 'minute')
  if (seconds < 86400) return format.format(-Math.floor(seconds / 3600), 'hour')
  if (seconds < 604800)
    return format.format(-Math.floor(seconds / 86400), 'day')
  return new Date(iso).toLocaleDateString()
}

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
        <DialogHeader className="gap-3 border-b border-divider pb-3.5">
          <div className="min-w-0 pr-7.5">
            <DialogTitle className="flex items-center gap-2">
              {task?.workspace?.title || task?.workspaceName}
              {task && (
                <span
                  className="inline-flex items-center rounded-sm border border-current px-1 py-px type-overline select-none"
                  style={{ color: taskStatusColor(task.status) }}
                >
                  {statusLabel(task.status)}
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
              className="flex items-center gap-2 type-body text-foreground"
              title={t('tasks.assignee', 'Assignee')}
            >
              {task?.assignee ? (
                <>
                  <span
                    className="flex size-4.5 items-center justify-center rounded-full type-count-small text-presence-foreground select-none"
                    style={{ backgroundColor: presenceColor(task.assignee) }}
                  >
                    {presenceInitials(assigneeLabel ?? '?')}
                  </span>
                  {assigneeLabel ?? task.assignee}
                </>
              ) : (
                <>
                  <span className="flex size-4.5 items-center justify-center rounded-full bg-border type-caption text-muted-foreground select-none">
                    ?
                  </span>
                  <span className="text-muted-foreground">
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
                {t('tasks.checkoutWorkspace', 'Checkout workspace')}
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

        <TaskComments workspaceName={task?.workspaceName ?? null} />
      </DialogContent>
    </Dialog>
  )
}

/**
 * The task's conversation, social-media style: avatar, name + bubble,
 * relative time, composer at the bottom (Enter sends, Shift+Enter breaks).
 */
function TaskComments({ workspaceName }: { workspaceName: string | null }) {
  const { data } = useTaskComments(workspaceName)
  const [text, setText] = useState('')

  const send = useMutation({
    mutationFn: () => addTaskComment(workspaceName ?? '', text.trim()),
    onSuccess: () => {
      setText('')
      // The tasks prefix covers this thread's key AND the board's per-card
      // commentCount - the badge updates immediately, not on the next poll.
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks })
    },
    onError: (error) =>
      toast.error(
        apiErrorDescription(
          error,
          t('tasks.commentFailedDetail', 'Adding the comment failed.'),
        ),
        { title: t('tasks.commentFailed', 'Could not add comment') },
      ),
  })

  const submit = (event?: FormEvent) => {
    event?.preventDefault()
    if (workspaceName && text.trim() !== '' && !send.isPending) send.mutate()
  }

  const comments = data?.comments ?? []

  return (
    <div>
      <div className="type-small text-muted-foreground">
        {t('tasks.comments', 'Comments')}
      </div>

      <div className="mt-2 flex max-h-60 flex-col gap-3 overflow-y-auto">
        {comments.length === 0 && (
          <div className="type-small text-muted-foreground">
            {t('tasks.noComments', 'No comments yet.')}
          </div>
        )}
        {comments.map((comment) => (
          <div key={comment.id} className="flex items-start gap-2">
            <span
              className="mt-0.5 flex size-5.5 shrink-0 items-center justify-center rounded-full type-count text-presence-foreground select-none"
              style={{
                backgroundColor: comment.author
                  ? presenceColor(comment.author)
                  : 'var(--color-presence-unknown)',
              }}
              aria-hidden
            >
              {presenceInitials(comment.authorLabel ?? '?')}
            </span>
            <div className="min-w-0 flex-1">
              <div className="w-fit max-w-full rounded-lg rounded-tl-none bg-muted px-3 py-1.5">
                <div className="type-small-strong text-foreground">
                  {comment.authorLabel ?? comment.author}
                </div>
                <div className="type-body wrap-break-word whitespace-pre-line text-foreground">
                  {comment.text}
                </div>
              </div>
              <div
                className="mt-0.5 type-caption text-muted-foreground"
                title={new Date(comment.createdAt).toLocaleString()}
              >
                {timeAgo(comment.createdAt)}
              </div>
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={submit} className="mt-3 flex items-end gap-2">
        <Textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              submit()
            }
          }}
          placeholder={t('tasks.commentPlaceholder', 'Write a comment…')}
          rows={3}
          className="flex-1"
        />
        <Button
          type="submit"
          size="icon"
          title={t('tasks.commentSend', 'Send')}
          aria-label={t('tasks.commentSend', 'Send')}
          disabled={text.trim() === '' || send.isPending}
        >
          <i
            className={`fas ${send.isPending ? 'fa-spinner fa-spin' : 'fa-paper-plane'}`}
            aria-hidden
          />
        </Button>
      </form>
    </div>
  )
}
