import { useEffect, useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'

import { apiErrorDescription } from '@/api/client'
import { queryKeys } from '@/api/keys'
import { assignTask, updateTask, type Task } from '@/api/tasks'
import { useUsers } from '@/api/users'
import { queryClient } from '@/app/queryClient'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/components/ui/toast'
import { translate as t } from '@/lib/i18n'

const UNASSIGNED = '__unassigned__'

function statusLabel(status: Task['status']): string {
  switch (status) {
    case 'IN_REVIEW':
      return t('tasks.statusInReview', 'in review')
    case 'DONE':
      return t('tasks.statusDone', 'done')
    default:
      return t('tasks.statusOpen', 'open')
  }
}

/**
 * The task detail: edit title, description, ticket reference, due date and
 * the assignee. Editing needs manage permission on the task workspace
 * (creator/reviewers) - without it the dialog is read-only. Opening the
 * workspace for editing stays in the card's action menu; this dialog is
 * about the task itself.
 */
export function TaskDetailDialog({
  task,
  onOpenChange,
  onCheckout,
}: {
  task: Task | null
  onOpenChange: (open: boolean) => void
  /** Check the task workspace out for direct editing (closes the dialog). */
  onCheckout: (task: Task) => void
}) {
  const { data: usersData } = useUsers()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [assignee, setAssignee] = useState(UNASSIGNED)
  const [ticketReference, setTicketReference] = useState('')
  const [dueDate, setDueDate] = useState('')

  useEffect(() => {
    if (task) {
      setTitle(task.workspace?.title ?? task.workspaceName)
      setDescription(task.workspace?.description ?? '')
      setAssignee(task.assignee ?? UNASSIGNED)
      setTicketReference(task.ticketReference ?? '')
      setDueDate(task.dueDate ? task.dueDate.slice(0, 10) : '')
    }
  }, [task])

  const canManage = task?.workspace?.permissions.manage ?? false
  const canWrite = task?.workspace?.permissions.write ?? false

  const assigneeItems = [
    { value: UNASSIGNED, label: t('tasks.unassigned', '– unassigned –') },
    ...(usersData?.users ?? []).map((user) => ({
      value: user.id,
      label: user.label,
    })),
  ]

  const mutation = useMutation({
    mutationFn: async () => {
      if (!task) return
      await updateTask(task.workspaceName, {
        title: title.trim(),
        description: description.trim(),
        ...(ticketReference.trim() !== ''
          ? { ticketReference: ticketReference.trim() }
          : {}),
        ...(dueDate !== '' ? { dueDate } : {}),
      })
      const newAssignee = assignee === UNASSIGNED ? null : assignee
      if (newAssignee !== (task.assignee ?? null)) {
        await assignTask(task.workspaceName, newAssignee)
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks })
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all })
      toast.success(t('tasks.updated', 'The task has been updated.'))
      onOpenChange(false)
    },
    onError: (error) =>
      toast.error(
        apiErrorDescription(
          error,
          t('tasks.updateFailedDetail', 'Updating the task failed.'),
        ),
        { title: t('tasks.updateFailed', 'Could not update task') },
      ),
  })

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (canManage && title.trim() !== '' && !mutation.isPending) {
      mutation.mutate()
    }
  }

  return (
    <Dialog open={task !== null} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {task?.workspace?.title || task?.workspaceName}
            {task && (
              <Badge variant="secondary">{statusLabel(task.status)}</Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {canManage
              ? t('tasks.detailHint', 'Edit the task details below.')
              : t(
                  'tasks.detailReadOnly',
                  'You need manage permission on this task to edit it.',
                )}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <Field label={t('tasks.title', 'Title')} htmlFor="task-detail-title">
            <Input
              id="task-detail-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={!canManage}
              autoComplete="off"
              required
            />
          </Field>

          <Field
            label={t('tasks.description', 'Description')}
            htmlFor="task-detail-description"
          >
            <Textarea
              id="task-detail-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              disabled={!canManage}
              rows={2}
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field
              label={t('tasks.assignee', 'Assignee')}
              htmlFor="task-detail-assignee"
            >
              <Select
                value={assignee}
                onValueChange={(value) => setAssignee(value as string)}
                items={assigneeItems}
                disabled={!canManage}
              >
                <SelectTrigger id="task-detail-assignee" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {assigneeItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field
              label={t('tasks.dueDate', 'Due date')}
              htmlFor="task-detail-due"
            >
              <Input
                id="task-detail-due"
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
                disabled={!canManage}
              />
            </Field>
          </div>

          <Field
            label={t('tasks.ticketReference', 'Ticket reference')}
            htmlFor="task-detail-ticket"
          >
            <Input
              id="task-detail-ticket"
              placeholder="PROJ-123"
              value={ticketReference}
              onChange={(event) => setTicketReference(event.target.value)}
              disabled={!canManage}
              autoComplete="off"
            />
          </Field>

          <DialogFooter className="items-center">
            <Button
              type="button"
              variant="ghost"
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
              disabled={mutation.isPending}
            >
              {canManage
                ? t('common.cancel', 'Cancel')
                : t('common.close', 'Close')}
            </Button>
            {canManage && (
              <Button
                type="submit"
                disabled={title.trim() === '' || mutation.isPending}
              >
                {mutation.isPending
                  ? t('tasks.saving', 'Saving…')
                  : t('common.save', 'Save')}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
