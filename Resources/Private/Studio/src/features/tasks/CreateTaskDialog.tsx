import { useEffect, useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'

import { apiErrorDescription } from '@/api/client'
import { queryKeys } from '@/api/keys'
import { createTask, useTasks, type Task } from '@/api/tasks'
import { useUsers } from '@/api/users'
import { useWorkspaces } from '@/api/workspaces'
import { queryClient } from '@/app/queryClient'
import { useStudio } from '@/app/StudioContext'
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

/**
 * Create a task branch: a shared workspace restricted to the involved
 * people (creator, assignee, reviewers) plus the task metadata.
 * Modelled on the CreateWorkspaceDialog.
 */
export function CreateTaskDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called with the created task - e.g. the switcher checking it out. */
  onCreated?: (task: Task) => void
}) {
  const { data: usersData } = useUsers()
  const { data: workspacesData } = useWorkspaces(open)
  const { personalWorkspaceName } = useStudio()
  const { data: tasksData } = useTasks(open)

  /**
   * Where a new task branch hangs by default: the workspace its creator
   * publishes into anyway - their own personal workspace's base.
   *
   * NOT live. A task is a side branch of ordinary editorial work, and in a
   * setup that reviews through a shared draft, hanging it off live means every
   * publish out of a task bypasses that draft and goes straight to the public
   * site. Which is neither what "publish" means anywhere else in the UI, nor
   * something the act itself gives any hint of.
   */
  const defaultBase =
    tasksData?.defaultBaseWorkspace ??
    (workspacesData?.workspaces ?? []).find(
      (workspace) => workspace.name === personalWorkspaceName,
    )?.baseWorkspace ??
    'live'

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [baseWorkspace, setBaseWorkspace] = useState(defaultBase)
  // null = unassigned; the trigger then shows the "Select user" placeholder.
  const [assignee, setAssignee] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setTitle('')
      setDescription('')
      setBaseWorkspace(defaultBase)
      setAssignee(null)
    }
  }, [open, defaultBase])

  // Base candidates: live and shared workspaces (incl. other task branches -
  // stacking a task on a feature branch is legitimate).
  const baseItems = (workspacesData?.workspaces ?? [])
    .filter(
      (workspace) =>
        workspace.classification === 'ROOT' ||
        workspace.classification === 'SHARED',
    )
    .map((workspace) => ({
      value: workspace.name,
      label:
        workspace.classification === 'ROOT'
          ? t('workspace.live', 'Live')
          : workspace.title || workspace.name,
    }))
  if (baseItems.length === 0) {
    baseItems.push({ value: 'live', label: t('workspace.live', 'Live') })
  }
  const assigneeItems = (usersData?.users ?? []).map((user) => ({
    value: user.id,
    label: user.label,
  }))

  const mutation = useMutation({
    mutationFn: () =>
      createTask({
        title: title.trim(),
        ...(description.trim() !== ''
          ? { description: description.trim() }
          : {}),
        baseWorkspace,
        ...(assignee !== null ? { assignee } : {}),
      }),
    onSuccess: async (response) => {
      // Await the refetch: a consumer checking the new workspace out right
      // away (the switcher) needs it IN the cached workspace list first -
      // the app resets an editing context it cannot resolve there.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks }),
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all }),
      ])
      toast.success(
        t('tasks.created', 'The task "{0}" has been created.', [
          response.task.workspace?.title ?? title.trim(),
        ]),
      )
      onOpenChange(false)
      onCreated?.(response.task)
    },
    onError: (error) =>
      toast.error(
        apiErrorDescription(
          error,
          t('tasks.createFailedDetail', 'Creating the task failed.'),
        ),
        { title: t('tasks.createFailed', 'Could not create task') },
      ),
  })

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (title.trim() !== '' && !mutation.isPending) mutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{t('tasks.newTask', 'New task')}</DialogTitle>
          <DialogDescription>
            {t(
              'tasks.newTaskHint',
              'A task branch collects changes for one job. Only involved people see it; reviewers approve and publish it.',
            )}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <Field label={t('tasks.title', 'Title')} htmlFor="task-create-title">
            <Input
              id="task-create-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              autoComplete="off"
              required
            />
          </Field>

          <Field
            label={t('tasks.description', 'Description')}
            htmlFor="task-create-description"
          >
            <Textarea
              id="task-create-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={2}
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field
              label={t('tasks.baseWorkspace', 'Based on')}
              htmlFor="task-create-base"
            >
              <Select
                value={baseWorkspace}
                onValueChange={(value) => setBaseWorkspace(value as string)}
                items={baseItems}
              >
                <SelectTrigger id="task-create-base" className="w-full">
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
              {/* Where publishing out of this task will land. Said at the
                  moment the branch is created, because that is the only
                  moment the choice is being made - afterwards it is invisible
                  and every publish silently follows it. */}
              <span className="mt-1 block text-xs text-neutral-600 dark:text-neutral-400">
                {t(
                  'tasks.baseWorkspaceHint',
                  'Publishing this task later goes to "{0}".',
                  [
                    baseItems.find((item) => item.value === baseWorkspace)
                      ?.label ?? baseWorkspace,
                  ],
                )}
              </span>
            </Field>
            <Field
              label={t('tasks.assignee', 'Assignee')}
              htmlFor="task-create-assignee"
            >
              <Select
                value={assignee}
                onValueChange={(value) => setAssignee(value as string)}
                items={assigneeItems}
              >
                <SelectTrigger id="task-create-assignee" className="w-full">
                  <SelectValue
                    placeholder={t('tasks.selectUser', 'Select user')}
                    className="data-placeholder:text-neutral-600 dark:data-placeholder:text-neutral-400"
                  />
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
          </div>

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
              type="submit"
              disabled={title.trim() === '' || mutation.isPending}
            >
              {mutation.isPending
                ? t('tasks.creating', 'Creating…')
                : t('tasks.create', 'Create task')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
