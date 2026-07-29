import { useQuery } from '@tanstack/react-query'
import { apiFetch } from './client'
import { queryKeys } from './keys'
import type { Workspace } from './workspaces'

/**
 * The task workflow: TASK/FEATURE branches are ordinary shared workspaces
 * plus sidecar metadata (see TasksController / TaskWorkspaceService). The
 * same metadata also rides on every workspace object as
 * workspace.extensions[TASK_EXTENSION_KEY].
 */

/** The enricher's registration key inside workspace.extensions. */
export const TASK_EXTENSION_KEY = 'Medienreaktor.NeosStudio:task'

export type TaskType = 'TASK' | 'FEATURE'
export type TaskStatus = 'OPEN' | 'IN_REVIEW' | 'DONE'

/** One task, as served by GET /api/tasks. */
export interface Task {
  workspaceName: string
  type: TaskType
  status: TaskStatus
  assignee: string | null
  createdBy: string | null
  ticketReference: string | null
  dueDate: string | null
  createdAt: string
  /** The underlying workspace incl. the account's permissions; null if stale. */
  workspace: Workspace | null
}

/** The extensions contribution's shape (a subset of Task, per workspace). */
export interface TaskExtension {
  type: TaskType
  status: TaskStatus
  assignee: string | null
  assigneeLabel: string | null
  createdBy: string | null
  ticketReference: string | null
  dueDate: string | null
  createdAt: string
}

export function taskOf(workspace: Workspace): TaskExtension | null {
  const task = workspace.extensions?.[TASK_EXTENSION_KEY]
  return task ? (task as TaskExtension) : null
}

export function useTasks(enabled = true) {
  return useQuery({
    queryKey: queryKeys.tasks,
    queryFn: () => apiFetch<{ tasks: Task[] }>('/tasks'),
    enabled,
    refetchInterval: 30_000,
  })
}

export interface CreateTaskInput {
  title: string
  type: TaskType
  description?: string
  baseWorkspace?: string
  assignee?: string
  ticketReference?: string
  dueDate?: string
}

export function createTask(input: CreateTaskInput): Promise<{ task: Task }> {
  return apiFetch<{ task: Task }>('/tasks', { method: 'POST', body: input })
}

/**
 * The endpoint realizing a status transition - moving INTO a column drives
 * the workflow: to review = submit, back to open = reopen, to done = approve
 * (which publishes the workspace to its base).
 */
export function transitionTask(
  workspaceName: string,
  target: TaskStatus,
): Promise<{ task: Task }> {
  const action =
    target === 'IN_REVIEW' ? 'submit' : target === 'DONE' ? 'approve' : 'reopen'
  return apiFetch<{ task: Task }>(
    `/tasks/${encodeURIComponent(workspaceName)}/${action}`,
    { method: 'POST', body: {} },
  )
}

export function assignTask(
  workspaceName: string,
  assignee: string | null,
): Promise<{ task: Task }> {
  return apiFetch<{ task: Task }>(
    `/tasks/${encodeURIComponent(workspaceName)}/assign`,
    { method: 'POST', body: { assignee } },
  )
}

export function deleteTask(workspaceName: string): Promise<{ deleted: string }> {
  return apiFetch<{ deleted: string }>(
    `/tasks/${encodeURIComponent(workspaceName)}`,
    { method: 'DELETE' },
  )
}

/**
 * Which columns a task may be dragged to by the current account - mirroring
 * the server's checks so invalid drops never start: submit/reopen need write
 * access on the task workspace, approve needs manage (creator/reviewers)
 * plus publish rights on the base workspace.
 */
export function allowedTargets(task: Task): TaskStatus[] {
  const permissions = task.workspace?.permissions
  if (!permissions) return []
  const targets: TaskStatus[] = []
  if (permissions.write && task.status !== 'OPEN') targets.push('OPEN')
  if (permissions.write && task.status !== 'IN_REVIEW') targets.push('IN_REVIEW')
  if (permissions.manage && permissions.publish && task.status !== 'DONE') {
    targets.push('DONE')
  }
  return targets
}
