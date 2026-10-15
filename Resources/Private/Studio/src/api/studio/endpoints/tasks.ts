import { useQuery } from '@tanstack/react-query'
import {
  activeContentRepositoryId,
  useActiveContentRepositoryId,
} from '../../neos/activeContentRepository'
import { contentRepositoryPath, type Listing } from '../../neos/client'
import { studioFetch } from '../client'
import { studioKeys } from '../keys'
import type {
  Task,
  TaskComment,
  TaskCreate,
  TaskStatus,
  TaskUpdate,
} from '../schema'

/**
 * The task workflow: task branches are ordinary shared workspaces plus the
 * Studio's record of who works on them (the Studio API's Tasks), in the
 * selected site's content repository.
 */

function tasksPath(contentRepositoryId: string = activeContentRepositoryId()) {
  return `${contentRepositoryPath(contentRepositoryId)}/tasks`
}

export function useTasks(enabled = true) {
  const contentRepositoryId = useActiveContentRepositoryId()
  return useQuery({
    queryKey: studioKeys.tasks.list(contentRepositoryId ?? ''),
    queryFn: () => studioFetch<Listing<Task>>(tasksPath(contentRepositoryId!)),
    enabled: enabled && contentRepositoryId !== null,
    refetchInterval: 300_000,
    select: (listing) => listing.data,
  })
}

function taskPath(
  workspaceName: string,
  suffix = '',
  contentRepositoryId: string = activeContentRepositoryId(),
): string {
  return `${tasksPath(contentRepositoryId)}/${encodeURIComponent(workspaceName)}${suffix}`
}

export function createTask(input: TaskCreate): Promise<Task> {
  return studioFetch<Task>(tasksPath(), { method: 'POST', body: input })
}

export function updateTask(
  workspaceName: string,
  input: TaskUpdate,
): Promise<Task> {
  return studioFetch<Task>(taskPath(workspaceName), {
    method: 'PATCH',
    body: input,
  })
}

/**
 * The operation realizing a status transition - moving INTO a column drives
 * the workflow: to review = submit, back to open = reopen, to done = approve.
 * Approving does NOT publish - the board opens the Review Changes dialog
 * first and completes the task afterwards. Submitting takes an optional
 * comment for the reviewers (it joins the task's comment thread).
 */
export function transitionTask(
  workspaceName: string,
  target: TaskStatus,
  comment?: string,
): Promise<Task> {
  if (target === 'IN_REVIEW') {
    return studioFetch<Task>(taskPath(workspaceName, '/submit'), {
      method: 'POST',
      body: comment ? { comment } : {},
    })
  }
  return studioFetch<Task>(
    taskPath(workspaceName, target === 'DONE' ? '/approve' : '/reopen'),
    { method: 'POST' },
  )
}

/** The task's comment thread, oldest first. Pass null while no task is open. */
export function useTaskComments(workspaceName: string | null) {
  const contentRepositoryId = useActiveContentRepositoryId()
  return useQuery({
    queryKey: studioKeys.tasks.comments(
      contentRepositoryId ?? '',
      workspaceName ?? '',
    ),
    queryFn: () =>
      studioFetch<Listing<TaskComment>>(
        taskPath(workspaceName!, '/comments', contentRepositoryId!),
      ),
    enabled: workspaceName !== null && contentRepositoryId !== null,
    select: (listing) => listing.data,
  })
}

export function addTaskComment(
  workspaceName: string,
  text: string,
): Promise<TaskComment> {
  return studioFetch<TaskComment>(taskPath(workspaceName, '/comments'), {
    method: 'POST',
    body: { text },
  })
}

export function assignTask(
  workspaceName: string,
  assignee: string | null,
): Promise<Task> {
  return studioFetch<Task>(taskPath(workspaceName, '/assignee'), {
    method: 'PUT',
    body: { assignee },
  })
}

export function deleteTask(workspaceName: string): Promise<null> {
  return studioFetch<null>(taskPath(workspaceName), { method: 'DELETE' })
}
