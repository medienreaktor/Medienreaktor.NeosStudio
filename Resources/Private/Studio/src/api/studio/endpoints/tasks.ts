import { useQuery } from '@tanstack/react-query'
import { studioFetch } from '../client'
import { studioKeys } from '../keys'
import type {
  CreateTaskInput,
  Task,
  TaskComment,
  TaskStatus,
  UpdateTaskInput,
} from '../schema'

/**
 * The task workflow: task branches are ordinary shared workspaces plus the
 * Studio's sidecar record (see TasksController / TaskWorkspaceService).
 */

export function useTasks(enabled = true) {
  return useQuery({
    queryKey: studioKeys.tasks.all,
    queryFn: () => studioFetch<{ tasks: Task[] }>('/tasks'),
    enabled,
    refetchInterval: 300_000,
    select: (response) => response.tasks,
  })
}

function taskPath(workspaceName: string, suffix = ''): string {
  return `/tasks/${encodeURIComponent(workspaceName)}${suffix}`
}

export function createTask(input: CreateTaskInput): Promise<{ task: Task }> {
  return studioFetch<{ task: Task }>('/tasks', { method: 'POST', body: input })
}

export function updateTask(
  workspaceName: string,
  input: UpdateTaskInput,
): Promise<{ task: Task }> {
  return studioFetch<{ task: Task }>(taskPath(workspaceName), {
    method: 'POST',
    body: input,
  })
}

/**
 * The endpoint realizing a status transition - moving INTO a column drives
 * the workflow: to review = submit, back to open = reopen, to done = approve.
 * Approving does NOT publish - the board opens the Review Changes dialog
 * first and completes the task afterwards. Submitting takes an optional
 * comment for the reviewers (it joins the task's comment thread).
 */
export function transitionTask(
  workspaceName: string,
  target: TaskStatus,
  comment?: string,
): Promise<{ task: Task }> {
  const action =
    target === 'IN_REVIEW' ? 'submit' : target === 'DONE' ? 'approve' : 'reopen'
  return studioFetch<{ task: Task }>(taskPath(workspaceName, `/${action}`), {
    method: 'POST',
    body: comment ? { comment } : {},
  })
}

/** The task's comment thread, oldest first. Pass null while no task is open. */
export function useTaskComments(workspaceName: string | null) {
  return useQuery({
    queryKey: studioKeys.tasks.comments(workspaceName ?? ''),
    queryFn: () =>
      studioFetch<{ comments: TaskComment[] }>(
        taskPath(workspaceName!, '/comments'),
      ),
    enabled: workspaceName !== null,
  })
}

export function addTaskComment(
  workspaceName: string,
  text: string,
): Promise<{ comment: TaskComment }> {
  return studioFetch<{ comment: TaskComment }>(
    taskPath(workspaceName, '/comments'),
    { method: 'POST', body: { text } },
  )
}

export function assignTask(
  workspaceName: string,
  assignee: string | null,
): Promise<{ task: Task }> {
  return studioFetch<{ task: Task }>(taskPath(workspaceName, '/assign'), {
    method: 'POST',
    body: { assignee },
  })
}

export function deleteTask(
  workspaceName: string,
): Promise<{ deleted: string }> {
  return studioFetch<{ deleted: string }>(taskPath(workspaceName), {
    method: 'DELETE',
  })
}
