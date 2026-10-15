import { skipToken, useQuery } from '@tanstack/react-query'
import { useActiveContentRepositoryId } from '../../neos/activeContentRepository'
import { api, unwrap } from '../../neos/client'
import { studioKeys } from '../keys'
import type {
  Task,
  TaskAssigneeChange,
  TaskComment,
  TaskCommentCreate,
  TaskCreate,
  TaskStatus,
  TaskSubmit,
  TaskUpdate,
} from '../schema'

/**
 * The task workflow: task branches are ordinary shared workspaces plus the
 * Studio's record of who works on them (the Studio API's Tasks). The hooks
 * read the selected site's content repository; the writes name theirs
 * explicitly - the content repository of the task's workspace.
 */

const TASK = '/cr/{contentRepositoryId}/tasks/{workspaceName}'

/** The path parameters of a task operation. */
function taskPath(contentRepositoryId: string, workspaceName: string) {
  return { contentRepositoryId, workspaceName }
}

export function useTasks(enabled = true) {
  const contentRepositoryId = useActiveContentRepositoryId()
  return useQuery({
    queryKey: studioKeys.tasks.list(contentRepositoryId ?? ''),
    queryFn:
      enabled && contentRepositoryId !== null
        ? ({ signal }) =>
            unwrap(
              api.GET('/cr/{contentRepositoryId}/tasks', {
                params: { path: { contentRepositoryId } },
                signal,
              }),
            )
        : skipToken,
    refetchInterval: 300_000,
    select: (listing) => listing.data,
  })
}

export function createTask(
  contentRepositoryId: string,
  input: TaskCreate,
): Promise<Task> {
  return unwrap(
    api.POST('/cr/{contentRepositoryId}/tasks', {
      params: { path: { contentRepositoryId } },
      body: input,
    }),
  )
}

export function updateTask(
  contentRepositoryId: string,
  workspaceName: string,
  input: TaskUpdate,
): Promise<Task> {
  return unwrap(
    api.PATCH(TASK, {
      params: { path: taskPath(contentRepositoryId, workspaceName) },
      body: input,
    }),
  )
}

/**
 * The operation realizing a status transition - moving INTO a column drives
 * the workflow: to review = submit, back to open = reopen, to done = approve.
 * Approving does NOT publish - the board opens the Review Changes dialog
 * first and completes the task afterwards. Submitting takes an optional
 * comment for the reviewers (it joins the task's comment thread).
 */
export function transitionTask(
  contentRepositoryId: string,
  workspaceName: string,
  target: TaskStatus,
  comment?: string,
): Promise<Task> {
  const params = { path: taskPath(contentRepositoryId, workspaceName) }
  if (target === 'IN_REVIEW') {
    return unwrap(
      api.POST(`${TASK}/submit`, {
        params,
        body: (comment ? { comment } : {}) satisfies TaskSubmit,
      }),
    )
  }
  return unwrap(
    target === 'DONE'
      ? api.POST(`${TASK}/approve`, { params })
      : api.POST(`${TASK}/reopen`, { params }),
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
    queryFn:
      workspaceName !== null && contentRepositoryId !== null
        ? ({ signal }) =>
            unwrap(
              api.GET(`${TASK}/comments`, {
                params: { path: taskPath(contentRepositoryId, workspaceName) },
                signal,
              }),
            )
        : skipToken,
    select: (listing) => listing.data,
  })
}

export function addTaskComment(
  contentRepositoryId: string,
  workspaceName: string,
  text: string,
): Promise<TaskComment> {
  return unwrap(
    api.POST(`${TASK}/comments`, {
      params: { path: taskPath(contentRepositoryId, workspaceName) },
      body: { text } satisfies TaskCommentCreate,
    }),
  )
}

export function assignTask(
  contentRepositoryId: string,
  workspaceName: string,
  assignee: string | null,
): Promise<Task> {
  return unwrap(
    api.PUT(`${TASK}/assignee`, {
      params: { path: taskPath(contentRepositoryId, workspaceName) },
      body: { assignee } satisfies TaskAssigneeChange,
    }),
  )
}

export async function deleteTask(
  contentRepositoryId: string,
  workspaceName: string,
): Promise<void> {
  await unwrap(
    api.DELETE(TASK, {
      params: { path: taskPath(contentRepositoryId, workspaceName) },
    }),
  )
}
