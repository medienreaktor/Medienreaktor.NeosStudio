import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'

import { apiErrorDescription } from '@/api/client'
import { queryKeys } from '@/api/keys'
import { assignTask, type Task } from '@/api/tasks'
import { useUsers } from '@/api/users'
import { queryClient } from '@/app/queryClient'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from '@/components/ui/toast'
import { translate as t } from '@/lib/i18n'

const UNASSIGNED = '__unassigned__'

/**
 * (Re-)assign a task to a user. Assignment also adjusts the workspace roles
 * server-side, so the assignee can actually work in the branch - and they get
 * notified.
 */
export function AssignTaskDialog({
  task,
  onOpenChange,
}: {
  task: Task | null
  onOpenChange: (open: boolean) => void
}) {
  const { data: usersData } = useUsers()
  const [assignee, setAssignee] = useState(UNASSIGNED)

  useEffect(() => {
    setAssignee(task?.assignee ?? UNASSIGNED)
  }, [task])

  const items = [
    { value: UNASSIGNED, label: t('tasks.unassigned', '– unassigned –') },
    ...(usersData?.users ?? []).map((user) => ({
      value: user.id,
      label: user.label,
    })),
  ]

  const mutation = useMutation({
    mutationFn: () =>
      assignTask(
        task!.workspaceName,
        assignee === UNASSIGNED ? null : assignee,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks })
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all })
      toast.success(t('tasks.assigned', 'The task has been reassigned.'))
      onOpenChange(false)
    },
    onError: (error) =>
      toast.error(
        apiErrorDescription(
          error,
          t('tasks.assignFailedDetail', 'Assigning the task failed.'),
        ),
        { title: t('tasks.assignFailed', 'Could not assign task') },
      ),
  })

  return (
    <Dialog open={task !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('tasks.assignTitle', 'Assign "{0}"', [
              task?.workspace?.title || task?.workspaceName || '',
            ])}
          </DialogTitle>
        </DialogHeader>

        <Field label={t('tasks.assignee', 'Assignee')} htmlFor="task-assignee">
          <Select
            value={assignee}
            onValueChange={(value) => setAssignee(value as string)}
            items={items}
          >
            <SelectTrigger id="task-assignee" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {items.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={task === null || mutation.isPending}
          >
            {mutation.isPending
              ? t('tasks.assigning', 'Assigning…')
              : t('tasks.assignConfirm', 'Assign')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
