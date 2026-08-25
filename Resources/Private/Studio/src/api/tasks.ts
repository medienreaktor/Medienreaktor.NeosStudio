import { useQuery } from '@tanstack/react-query'
import { apiFetch } from './client'
import { queryKeys } from './keys'
import type { Workspace } from './workspaces'

/**
 * The task workflow: task branches are ordinary shared workspaces plus
 * sidecar metadata (see TasksController / TaskWorkspaceService). The same
 * metadata also rides on every workspace object as
 * workspace.extensions[TASK_EXTENSION_KEY].
 */

/** The enricher's registration key inside workspace.extensions. */
export const TASK_EXTENSION_KEY = 'Medienreaktor.NeosStudio:task'

export type TaskStatus = 'OPEN' | 'IN_REVIEW' | 'DONE'

/** One task, as served by GET /api/tasks. */
export interface Task {
  workspaceName: string
  status: TaskStatus
  assignee: string | null
  createdBy: string | null
  createdAt: string
  commentCount: number
  /** The underlying workspace incl. the account's permissions; null if stale. */
  workspace: Workspace | null
}

/** The extensions contribution's shape (a subset of Task, per workspace). */
export interface TaskExtension {
  status: TaskStatus
  assignee: string | null
  assigneeLabel: string | null
  createdBy: string | null
  createdAt: string
}

export function taskOf(workspace: Workspace): TaskExtension | null {
  const task = workspace.extensions?.[TASK_EXTENSION_KEY]
  return task ? (task as TaskExtension) : null
}

export interface TasksResponse {
  tasks: Task[]
  /**
   * The workspace a new task would be based on - and therefore where
   * publishing out of it would land. Resolved server-side from configuration
   * (see taskWorkflow.defaultBaseWorkspace); null without a user-bound token.
   */
  defaultBaseWorkspace: string | null
}

export function useTasks(enabled = true) {
  return useQuery({
    queryKey: queryKeys.tasks,
    queryFn: () => apiFetch<TasksResponse>('/tasks'),
    enabled,
    refetchInterval: 300_000,
  })
}

export interface CreateTaskInput {
  title: string
  description?: string
  baseWorkspace?: string
  assignee?: string
}

export function createTask(input: CreateTaskInput): Promise<{ task: Task }> {
  return apiFetch<{ task: Task }>('/tasks', { method: 'POST', body: input })
}

export interface UpdateTaskInput {
  title: string
  description?: string
}

export function updateTask(
  workspaceName: string,
  input: UpdateTaskInput,
): Promise<{ task: Task }> {
  return apiFetch<{ task: Task }>(
    `/tasks/${encodeURIComponent(workspaceName)}`,
    { method: 'POST', body: input },
  )
}

/**
 * The endpoint realizing a status transition - moving INTO a column drives
 * the workflow: to review = submit, back to open = reopen, to done = approve.
 * Approving does NOT publish - the board opens the Review Changes dialog
 * first and completes the task afterwards.
 *
 * Both directions carry a note, and both keep it: submitting says what to look
 * at, reopening says what to fix, and either way it joins the task's comment
 * thread rather than living only in a notification that is read once and gone.
 * The two endpoints name the field differently (`comment` / `reason`), which
 * is why this maps it instead of passing it through - sending the wrong one
 * silently drops the text.
 */
export function transitionTask(
  workspaceName: string,
  target: TaskStatus,
  note?: string,
): Promise<{ task: Task }> {
  const action =
    target === 'IN_REVIEW' ? 'submit' : target === 'DONE' ? 'approve' : 'reopen'
  const body = !note
    ? {}
    : action === 'reopen'
      ? { reason: note }
      : { comment: note }
  return apiFetch<{ task: Task }>(
    `/tasks/${encodeURIComponent(workspaceName)}/${action}`,
    { method: 'POST', body },
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

export function deleteTask(
  workspaceName: string,
): Promise<{ deleted: string }> {
  return apiFetch<{ deleted: string }>(
    `/tasks/${encodeURIComponent(workspaceName)}`,
    { method: 'DELETE' },
  )
}

/**
 * Which columns a task may be dragged to by the current account - mirroring
 * the server's rules so invalid drops never start:
 *
 * - OPEN -> IN_REVIEW (submit) and IN_REVIEW -> OPEN (reopen) need write
 *   access on the task workspace (assignee or manager). A DONE task can only
 *   be reopened, never re-submitted.
 * - -> DONE opens the review flow (publish selected changes, then complete),
 *   which needs manage (creator/reviewers) plus publish rights on the base.
 */
export function allowedTargets(task: Task): TaskStatus[] {
  const permissions = task.workspace?.permissions
  if (!permissions) return []
  const targets: TaskStatus[] = []
  if (permissions.write && task.status !== 'OPEN') targets.push('OPEN')
  if (permissions.write && task.status === 'OPEN') targets.push('IN_REVIEW')
  if (permissions.manage && permissions.publish && task.status !== 'DONE') {
    targets.push('DONE')
  }
  return targets
}
