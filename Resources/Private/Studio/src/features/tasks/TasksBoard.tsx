import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'

import { apiErrorDescription } from '@/api/client'
import { queryKeys } from '@/api/keys'
import {
  allowedTargets,
  deleteTask,
  transitionTask,
  useTasks,
  type Task,
  type TaskStatus,
} from '@/api/tasks'
import { useUsers } from '@/api/users'
import { queryClient } from '@/app/queryClient'
import { useStudio } from '@/app/StudioContext'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toast'
import {
  presenceColor,
  presenceInitials,
} from '@/features/collaboration/presenceColors'
import { translate as t } from '@/lib/i18n'
import { AssignTaskDialog } from './AssignTaskDialog'
import { CreateTaskDialog } from './CreateTaskDialog'

const COLUMNS: { status: TaskStatus; title: () => string }[] = [
  { status: 'OPEN', title: () => t('tasks.columnOpen', 'Open') },
  { status: 'IN_REVIEW', title: () => t('tasks.columnInReview', 'In review') },
  { status: 'DONE', title: () => t('tasks.columnDone', 'Done') },
]

const TYPE_COLORS: Record<Task['type'], string> = {
  TASK: 'text-amber-400',
  FEATURE: 'text-emerald-400',
}

/**
 * The Tasks board: one column per status, task/feature workspaces as cards.
 * Dragging a card into a column drives the workflow (submit / reopen /
 * approve+publish); what the current account may drag where mirrors the
 * server's permission checks (see allowedTargets). Cards check the workspace
 * out for direct (collaborative) editing.
 */
export function TasksBoard() {
  const studio = useStudio()
  const { data, isLoading, error } = useTasks()
  const { data: usersData } = useUsers()
  const [dragged, setDragged] = useState<Task | null>(null)
  const [creating, setCreating] = useState(false)
  const [assigning, setAssigning] = useState<Task | null>(null)
  const [deleting, setDeleting] = useState<Task | null>(null)

  const userLabel = (userId: string | null): string | null =>
    userId
      ? (usersData?.users.find((user) => user.id === userId)?.label ?? null)
      : null

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.tasks })
    void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all })
  }

  const move = useMutation({
    mutationFn: ({ task, target }: { task: Task; target: TaskStatus }) =>
      transitionTask(task.workspaceName, target),
    onSuccess: (_response, { target }) => {
      if (target === 'DONE') {
        // Approving published the workspace into its base: cached node reads
        // and the preview may now be stale.
        studio.workspaceContentChanged()
        toast.success(
          t('tasks.approved', 'The task has been approved and published.'),
        )
      }
    },
    onError: (mutationError) =>
      toast.error(
        apiErrorDescription(
          mutationError,
          t('tasks.moveFailedDetail', 'Moving the task failed.'),
        ),
        { title: t('tasks.moveFailed', 'Could not move task') },
      ),
    onSettled: invalidate,
  })

  const checkout = (task: Task) => {
    studio.checkoutWorkspace(task.workspaceName)
    toast.info(
      t('tasks.checkedOut', 'Now editing in "{0}".', [
        task.workspace?.title || task.workspaceName,
      ]),
    )
  }

  if (error) {
    return (
      <div className="p-6 text-sm text-neutral-500">
        {t('tasks.loadFailed', 'Loading the tasks failed.')}{' '}
        {apiErrorDescription(error, '')}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 pt-3">
        <span className="text-xs text-neutral-500">
          {t(
            'tasks.boardHint',
            'Drag cards between columns to submit, reopen or approve & publish.',
          )}
        </span>
        <Button size="sm" onClick={() => setCreating(true)}>
          <i className="fas fa-plus" aria-hidden />
          {t('tasks.newTask', 'New task')}
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 items-stretch gap-3 overflow-x-auto p-3">
        {COLUMNS.map((column) => {
          const columnTasks = (data?.tasks ?? []).filter(
            (task) => task.status === column.status,
          )
          const droppable =
            dragged !== null &&
            dragged.status !== column.status &&
            allowedTargets(dragged).includes(column.status)
          return (
            <div
              key={column.status}
              className={`flex min-w-56 flex-1 flex-col rounded-md border bg-neutral-900/60 transition-colors ${
                droppable ? 'border-blue-500' : 'border-neutral-800'
              }`}
              onDragOver={(event) => {
                if (droppable) event.preventDefault()
              }}
              onDrop={(event) => {
                event.preventDefault()
                if (dragged && droppable) {
                  move.mutate({ task: dragged, target: column.status })
                }
                setDragged(null)
              }}
            >
              <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2 text-[0.7rem] font-semibold tracking-wide text-neutral-400 uppercase">
                {column.title()}
                <Badge variant="secondary">{columnTasks.length}</Badge>
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
                {isLoading && (
                  <>
                    <Skeleton className="h-20 w-full" />
                    <Skeleton className="h-20 w-full" />
                  </>
                )}
                {!isLoading && columnTasks.length === 0 && (
                  <div className="rounded-md border border-dashed border-neutral-800 py-4 text-center text-xs text-neutral-600">
                    {t('tasks.columnEmpty', 'No tasks')}
                  </div>
                )}
                {columnTasks.map((task) => (
                  <TaskCard
                    key={task.workspaceName}
                    task={task}
                    assigneeLabel={userLabel(task.assignee)}
                    draggable={allowedTargets(task).length > 0 && !move.isPending}
                    onDragStart={() => setDragged(task)}
                    onDragEnd={() => setDragged(null)}
                    onCheckout={() => checkout(task)}
                    onAssign={() => setAssigning(task)}
                    onDelete={() => setDeleting(task)}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>

      <CreateTaskDialog open={creating} onOpenChange={setCreating} />
      <AssignTaskDialog
        task={assigning}
        onOpenChange={(open) => !open && setAssigning(null)}
      />
      <ConfirmDialog
        open={deleting !== null}
        title={t('tasks.deleteTitle', 'Delete task?')}
        description={t(
          'tasks.deleteDescription',
          'This removes the workspace "{0}" including all its unpublished changes. This cannot be undone.',
          [deleting?.workspace?.title || deleting?.workspaceName || ''],
        )}
        confirmLabel={t('tasks.deleteConfirm', 'Delete task')}
        onOpenChange={(open) => !open && setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return
          await deleteTask(deleting.workspaceName)
          invalidate()
          toast.success(t('tasks.deleted', 'The task has been deleted.'))
        }}
      />
    </div>
  )
}

function TaskCard({
  task,
  assigneeLabel,
  draggable,
  onDragStart,
  onDragEnd,
  onCheckout,
  onAssign,
  onDelete,
}: {
  task: Task
  assigneeLabel: string | null
  draggable: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onCheckout: () => void
  onAssign: () => void
  onDelete: () => void
}) {
  const canWrite = task.workspace?.permissions.write ?? false
  const canManage = task.workspace?.permissions.manage ?? false
  const overdue =
    task.dueDate !== null &&
    task.status !== 'DONE' &&
    new Date(task.dueDate).getTime() < Date.now()

  return (
    <div
      className={`flex flex-col gap-1.5 rounded-md border border-neutral-800 bg-neutral-800/60 px-2.5 py-2 text-[0.78rem] text-neutral-200 ${
        draggable ? 'cursor-grab active:cursor-grabbing' : ''
      }`}
      draggable={draggable}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move'
        onDragStart()
      }}
      onDragEnd={onDragEnd}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={`rounded-sm border border-current px-1 py-px text-[0.58rem] font-bold tracking-wider select-none ${TYPE_COLORS[task.type]}`}
        >
          {task.type}
        </span>
        <span className="flex items-center gap-1">
          {task.ticketReference && (
            <span className="font-mono text-[0.65rem] text-neutral-500">
              {task.ticketReference}
            </span>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={t('tasks.cardMenu', 'Task actions')}
              className="flex size-5 cursor-pointer items-center justify-center rounded-sm text-neutral-500 hover:text-white focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-hidden"
            >
              <i className="fas fa-ellipsis-vertical text-[0.7rem]" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              <DropdownMenuGroup>
                <DropdownMenuItem disabled={!canWrite} onClick={onCheckout}>
                  <i
                    className="fas fa-arrow-right-to-bracket w-4 text-center"
                    aria-hidden
                  />
                  {t('tasks.openWorkspace', 'Open workspace')}
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!canManage} onClick={onAssign}>
                  <i className="fas fa-user-pen w-4 text-center" aria-hidden />
                  {t('tasks.assign', 'Assign…')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={!canManage} onClick={onDelete}>
                  <i className="fas fa-trash-can w-4 text-center" aria-hidden />
                  {t('tasks.delete', 'Delete task')}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </div>

      <button
        type="button"
        className={`text-left font-semibold text-white ${canWrite ? 'cursor-pointer hover:underline' : ''}`}
        onClick={() => canWrite && onCheckout()}
        title={
          canWrite
            ? t('tasks.openWorkspaceHint', 'Check out and edit in this workspace')
            : undefined
        }
      >
        {task.workspace?.title || task.workspaceName}
      </button>
      {task.workspace?.description && (
        <span className="line-clamp-2 text-xs text-neutral-400">
          {task.workspace.description}
        </span>
      )}

      <div className="mt-0.5 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          {task.assignee ? (
            <span
              className="flex size-5 items-center justify-center rounded-full text-[0.55rem] font-semibold text-white select-none"
              style={{ backgroundColor: presenceColor(task.assignee) }}
              title={
                assigneeLabel
                  ? t('tasks.assignedTo', 'Assigned to {0}', [assigneeLabel])
                  : undefined
              }
            >
              {presenceInitials(assigneeLabel ?? '?')}
            </span>
          ) : (
            <span
              className="flex size-5 items-center justify-center rounded-full bg-neutral-700 text-[0.55rem] text-neutral-400 select-none"
              title={t('tasks.unassignedHint', 'Unassigned')}
            >
              ?
            </span>
          )}
          {task.dueDate && (
            <span
              className={`text-[0.65rem] ${overdue ? 'font-semibold text-red-400' : 'text-neutral-500'}`}
              title={t('tasks.dueDate', 'Due date')}
            >
              <i className="far fa-clock" aria-hidden />{' '}
              {new Date(task.dueDate).toLocaleDateString()}
            </span>
          )}
        </span>
        {task.workspace?.hasPublishableChanges && (
          <span
            className="size-1.5 rounded-full bg-orange-400"
            title={t('tasks.hasChanges', 'Has unpublished changes')}
          />
        )}
      </div>
    </div>
  )
}
