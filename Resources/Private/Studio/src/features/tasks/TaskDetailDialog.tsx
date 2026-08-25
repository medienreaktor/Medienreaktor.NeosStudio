import { useEffect, useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'

import { apiErrorDescription } from '@/api/client'
import { queryKeys } from '@/api/keys'
import { assignTask, updateTask, type Task } from '@/api/tasks'
import { useUsers } from '@/api/users'
import { changeBaseWorkspace, useWorkspaces } from '@/api/workspaces'
import { queryClient } from '@/app/queryClient'
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

/**
 * The task EDIT dialog: title, description and the assignee as a form.
 * Editing needs manage permission on the task workspace (creator/
 * reviewers) - without it the dialog is read-only. Plain viewing (and the
 * checkout action) lives in TaskViewDialog; this dialog is reached through
 * its "Edit task" button or the card's context menu.
 */
export function TaskDetailDialog({
  task,
  onOpenChange,
}: {
  task: Task | null
  onOpenChange: (open: boolean) => void
}) {
  const { data: usersData } = useUsers()
  const { data: workspacesData } = useWorkspaces(task !== null)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [assignee, setAssignee] = useState(UNASSIGNED)
  const [baseWorkspace, setBaseWorkspace] = useState('live')

  useEffect(() => {
    if (task) {
      setTitle(task.workspace?.title ?? task.workspaceName)
      setDescription(task.workspace?.description ?? '')
      setAssignee(task.assignee ?? UNASSIGNED)
      setBaseWorkspace(task.workspace?.baseWorkspace ?? 'live')
    }
  }, [task])

  const canManage = task?.workspace?.permissions.manage ?? false

  /**
   * Re-basing rewrites the branch onto another workspace, which the content
   * repository refuses while it still holds unpublished changes - there would
   * be nothing left to replay them onto. Publish or discard them first.
   */
  const hasPendingChanges = task?.workspace?.hasPublishableChanges ?? false
  const canChangeBase = canManage && !hasPendingChanges

  // Bases on offer: live and shared workspaces, minus the task itself.
  const baseItems = (workspacesData?.workspaces ?? [])
    .filter(
      (workspace) =>
        workspace.name !== task?.workspaceName &&
        (workspace.classification === 'ROOT' ||
          workspace.classification === 'SHARED'),
    )
    .map((workspace) => ({
      value: workspace.name,
      label:
        workspace.classification === 'ROOT'
          ? t('workspace.live', 'Live')
          : workspace.title || workspace.name,
    }))
  if (!baseItems.some((item) => item.value === baseWorkspace)) {
    baseItems.unshift({ value: baseWorkspace, label: baseWorkspace })
  }

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
      })
      const newAssignee = assignee === UNASSIGNED ? null : assignee
      if (newAssignee !== (task.assignee ?? null)) {
        await assignTask(task.workspaceName, newAssignee)
      }
      // Where the task publishes to. The one edit here that moves content
      // rather than metadata, so it goes last - a refused rebase must not take
      // the rest of the form down with it.
      if (canChangeBase && baseWorkspace !== task.workspace?.baseWorkspace) {
        await changeBaseWorkspace(task.workspaceName, baseWorkspace)
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
          <DialogTitle>
            {task?.workspace?.title || task?.workspaceName}
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

          {/* Where this task publishes to. Invisible everywhere else, yet it
              decides whether finishing the task puts content on the public
              site or into the shared draft - so it is editable here rather
              than frozen at creation. */}
          <Field
            label={t('tasks.baseWorkspace', 'Based on')}
            htmlFor="task-detail-base"
          >
            <Select
              value={baseWorkspace}
              onValueChange={(value) => setBaseWorkspace(value as string)}
              items={baseItems}
              disabled={!canChangeBase}
            >
              <SelectTrigger id="task-detail-base" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {baseItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="mt-1 block text-xs text-neutral-600 dark:text-neutral-400">
              {hasPendingChanges
                ? t(
                    'tasks.baseWorkspaceLocked',
                    'Publishing this task goes to "{0}". To move it elsewhere, publish or discard its open changes first.',
                    [
                      baseItems.find((item) => item.value === baseWorkspace)
                        ?.label ?? baseWorkspace,
                    ],
                  )
                : t(
                    'tasks.baseWorkspaceHint',
                    'Publishing this task later goes to "{0}".',
                    [
                      baseItems.find((item) => item.value === baseWorkspace)
                        ?.label ?? baseWorkspace,
                    ],
                  )}
            </span>
          </Field>

          <DialogFooter className="items-center">
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
