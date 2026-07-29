import { useEffect, useState } from 'react'
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
import { useWorkspaces } from '@/api/workspaces'
import { queryClient } from '@/app/queryClient'
import { useStudio } from '@/app/StudioContext'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toast'
import {
  presenceColor,
  presenceInitials,
} from '@/features/collaboration/presenceColors'
import { ReviewChangesDialog } from '@/features/workspaces/ReviewChangesDialog'
import { translate as t } from '@/lib/i18n'
import { taskStatusColor } from './status'
import { CreateTaskDialog } from './CreateTaskDialog'
import { consumeTaskFocus, usePendingTaskFocus } from './focus'
import { TaskDetailDialog } from './TaskDetailDialog'
import { TaskViewDialog } from './TaskViewDialog'

const COLUMNS: { status: TaskStatus; title: () => string }[] = [
  { status: 'OPEN', title: () => t('tasks.columnOpen', 'Open') },
  { status: 'IN_REVIEW', title: () => t('tasks.columnInReview', 'In review') },
  { status: 'DONE', title: () => t('tasks.columnDone', 'Done') },
]

/**
 * The Tasks board: one column per status, task branches as cards. Dragging a
 * card drives the workflow: to "In review" = submit, back to "Open" = reopen.
 * Dropping on "Done" deliberately does NOT publish blindly - it opens the
 * Review Changes dialog on the task workspace so the reviewer picks what to
 * publish; once a publish succeeded the task is completed and the card moves.
 * Clicking a card (or a notification) opens the read-only task view, which
 * offers checkout and the edit dialog; the card's context menu reaches both
 * dialogs directly.
 */
export function TasksBoard() {
  const studio = useStudio()
  const { data, isLoading, error } = useTasks()
  const { data: usersData } = useUsers()
  const { data: workspacesData } = useWorkspaces()
  const [dragged, setDragged] = useState<Task | null>(null)
  const [creating, setCreating] = useState(false)
  const [viewing, setViewing] = useState<Task | null>(null)
  const [editing, setEditing] = useState<Task | null>(null)
  const [deleting, setDeleting] = useState<Task | null>(null)
  const [reviewing, setReviewing] = useState<Task | null>(null)

  const workspaces = workspacesData?.workspaces ?? []
  const activeWorkspace =
    workspaces.find((workspace) => workspace.name === studio.workspaceName) ??
    null

  // The tasks response embeds a workspace snapshot that only refreshes with
  // the board's 30s poll. Content edits invalidate the workspaces query
  // immediately (persistProperty/nodeActions), so prefer its live object -
  // the pending-changes dot must not lag a poll interval behind.
  const tasks = (data?.tasks ?? []).map((task) => ({
    ...task,
    workspace:
      workspaces.find((workspace) => workspace.name === task.workspaceName) ??
      task.workspace,
  }))

  // A pending "open this task" request (e.g. from a clicked notification):
  // once the list contains the workspace, open its read-only view. A request
  // for a task the account cannot see (or that is gone) is dropped once the
  // list has loaded, so it cannot linger and fire on a later poll.
  const pendingFocus = usePendingTaskFocus()
  useEffect(() => {
    if (pendingFocus === null || data === undefined) return
    const task = data.tasks.find(
      (candidate) => candidate.workspaceName === pendingFocus,
    )
    if (task) setViewing(task)
    consumeTaskFocus()
  }, [pendingFocus, data])

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

  const onDrop = (task: Task, target: TaskStatus) => {
    if (task.status === target) return
    if (target === 'DONE' && task.workspace?.hasPublishableChanges) {
      // Publishing is the reviewer's explicit decision: open the review
      // dialog on the task workspace; completion follows the publish.
      // With nothing to publish the task just completes directly.
      setReviewing(task)
      return
    }
    move.mutate(
      { task, target },
      {
        onSuccess: () => {
          if (target === 'DONE') {
            toast.success(t('tasks.completed', 'The task has been completed.'))
          }
        },
      },
    )
  }

  const onPublished = (sourceWorkspaceName: string) => {
    if (reviewing && sourceWorkspaceName === reviewing.workspaceName) {
      move.mutate(
        { task: reviewing, target: 'DONE' },
        {
          onSuccess: () =>
            toast.success(t('tasks.completed', 'The task has been completed.')),
        },
      )
      setReviewing(null)
    }
  }

  const checkout = (task: Task) => {
    setViewing(null)
    setEditing(null)
    // Already the editing context: switching would no-op, so no toast either.
    if (task.workspaceName === studio.workspaceName) return
    studio.checkoutWorkspace(task.workspaceName)
    // The same toast a switch via the workspace switcher shows - checking a
    // task branch out IS that switch, just triggered from the board.
    toast.success(t('workspace.switched', 'Workspace switched.'))
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
      <div className="flex shrink-0 items-center justify-end px-2 pt-2">
        <Button size="sm" onClick={() => setCreating(true)}>
          <i className="fas fa-plus" aria-hidden />
          {t('tasks.newTask', 'New task')}
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 items-stretch gap-2 overflow-x-auto p-2">
        {COLUMNS.map((column) => {
          const columnTasks = tasks.filter(
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
                if (dragged && droppable) onDrop(dragged, column.status)
                setDragged(null)
              }}
            >
              <div
                className="flex items-center gap-2 px-3 py-2"
                style={{ color: taskStatusColor(column.status) }}
              >
                <span className="inline-flex items-center rounded-sm border border-current px-1 py-px text-[0.6rem] leading-none font-semibold tracking-wide uppercase select-none">
                  {column.title()}
                </span>
                <Badge
                  variant="secondary"
                  className="text-current"
                  style={{
                    backgroundColor: `color-mix(in srgb, ${taskStatusColor(column.status)} 15%, transparent)`,
                  }}
                >
                  {columnTasks.length}
                </Badge>
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
                {isLoading && (
                  <>
                    <TaskCardSkeleton />
                    <TaskCardSkeleton />
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
                    active={task.workspaceName === studio.workspaceName}
                    assigneeLabel={userLabel(task.assignee)}
                    draggable={
                      allowedTargets(task).length > 0 && !move.isPending
                    }
                    onDragStart={() => setDragged(task)}
                    onDragEnd={() => setDragged(null)}
                    onView={() => setViewing(task)}
                    onEdit={() => setEditing(task)}
                    onCheckout={() => checkout(task)}
                    onDelete={() => setDeleting(task)}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* Creating checks the fresh branch out right away - same behavior as
          the switcher's "Add task workspace" entry, so the switcher always
          reflects the new task immediately. */}
      <CreateTaskDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={checkout}
      />
      <TaskViewDialog
        task={viewing}
        onOpenChange={(open) => !open && setViewing(null)}
        onCheckout={checkout}
        onEdit={(task) => {
          setViewing(null)
          setEditing(task)
        }}
      />
      <TaskDetailDialog
        task={editing}
        onOpenChange={(open) => !open && setEditing(null)}
      />
      {activeWorkspace && (
        <ReviewChangesDialog
          workspaces={workspaces}
          activeWorkspace={activeWorkspace}
          initialSourceName={reviewing?.workspaceName}
          open={reviewing !== null}
          onOpenChange={(open) => !open && setReviewing(null)}
          onNavigate={studio.navigateToNodeInWorkspace}
          onPublished={onPublished}
        />
      )}
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

/** Placeholder card mirroring TaskCard's frame: title, description, avatar. */
function TaskCardSkeleton() {
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-transparent bg-neutral-800 px-2.5 py-2">
      <Skeleton className="h-3.5 w-2/3 bg-neutral-700/60" />
      <div className="mt-0.5 flex items-center">
        <Skeleton className="size-5 rounded-full bg-neutral-700/60" />
      </div>
    </div>
  )
}

function TaskCard({
  task,
  active,
  assigneeLabel,
  draggable,
  onDragStart,
  onDragEnd,
  onView,
  onEdit,
  onCheckout,
  onDelete,
}: {
  task: Task
  /** The task workspace is the current editing context (checked out). */
  active: boolean
  assigneeLabel: string | null
  draggable: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onView: () => void
  onEdit: () => void
  onCheckout: () => void
  onDelete: () => void
}) {
  const canWrite = task.workspace?.permissions.write ?? false
  const canManage = task.workspace?.permissions.manage ?? false

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <div
            className={`flex cursor-pointer flex-col gap-1.5 rounded-md border bg-neutral-900 hover:bg-neutral-800 px-2.5 py-2 text-[0.78rem] text-neutral-200 ${
              active ? 'border-blue-500' : 'border-transparent'
            } ${draggable ? 'active:cursor-grabbing' : ''}`}
            title={
              active
                ? t(
                    'tasks.activeWorkspace',
                    'You are editing in this workspace',
                  )
                : undefined
            }
            draggable={draggable}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'move'
              onDragStart()
            }}
            onDragEnd={onDragEnd}
            onClick={onView}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onView()
            }}
          />
        }
      >
        <span className="font-semibold text-white">
          {task.workspace?.title || task.workspaceName}
        </span>

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
          </span>
          <span className="flex items-center gap-2">
            {task.commentCount > 0 && (
              <span
                className="flex items-center gap-1 text-xs text-neutral-400"
                title={t('tasks.comments', 'Comments')}
              >
                <i className="fas fa-comment text-[0.65rem]" aria-hidden />
                {task.commentCount}
              </span>
            )}
            {task.workspace?.hasPublishableChanges && (
              <span
                className="size-1.5 rounded-full bg-orange-400"
                title={t('tasks.hasChanges', 'Has unpublished changes')}
              />
            )}
          </span>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-44">
        <ContextMenuGroup>
          <ContextMenuItem onClick={onView}>
            <i className="fas fa-eye w-4 text-center" aria-hidden />
            {t('tasks.viewTask', 'View task')}
          </ContextMenuItem>
          <ContextMenuItem disabled={!canManage} onClick={onEdit}>
            <i className="fas fa-pen w-4 text-center" aria-hidden />
            {t('tasks.editTask', 'Edit task')}
          </ContextMenuItem>
          <ContextMenuItem disabled={!canWrite || active} onClick={onCheckout}>
            <i className="fas fa-code-branch w-4 text-center" aria-hidden />
            {t('tasks.checkoutWorkspace', 'Checkout workspace')}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            variant="destructive"
            disabled={!canManage}
            onClick={onDelete}
          >
            <i className="fas fa-trash-can w-4 text-center" aria-hidden />
            {t('tasks.delete', 'Delete task')}
          </ContextMenuItem>
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  )
}
