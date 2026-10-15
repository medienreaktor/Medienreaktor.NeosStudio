import { useEffect } from 'react'

import { useUsers } from '@/api/neos/endpoints/users'
import { useTasks } from '@/api/studio/endpoints/tasks'
import type { Task } from '@/api/studio/schema'
import { workspaceDecoratorRegistry } from '@/features/workspaces/decorators'

/**
 * The task data the tasks workspace decorator (see builtin.ts) reads.
 *
 * Workspace decorators are pure `(workspace) => decoration` functions called
 * during render for every listed workspace - they have no place to call a
 * hook. So useTaskDecorationData() mirrors the task list and the user labels
 * into a module snapshot (the same pattern as the access snapshot in
 * features/access/useAccess.ts) and tells the decorator registry to re-emit,
 * so every workspace listing re-renders with the fresh badges.
 */

let tasksByWorkspace = new Map<string, Task>()
let userLabels = new Map<string, string>()

/**
 * Keep the task decoration snapshot current. Called once by the App; the
 * queries are deduplicated, so it costs nothing beyond what the board and the
 * switcher read anyway. A failing task list only drops the badges.
 */
export function useTaskDecorationData(enabled = true): void {
  const { data: tasks } = useTasks(enabled)
  const { data: users } = useUsers(enabled)

  useEffect(() => {
    tasksByWorkspace = new Map(
      (tasks ?? []).map((task) => [task.workspaceName, task]),
    )
    userLabels = new Map((users ?? []).map((user) => [user.id, user.label]))
    workspaceDecoratorRegistry.refresh()
  }, [tasks, users])
}

/** The task whose branch the workspace is, from the last known task list. */
export function taskOfWorkspace(workspaceName: string): Task | null {
  return tasksByWorkspace.get(workspaceName) ?? null
}

/** The label of a user, from the last known users listing. */
export function knownUserLabel(userId: string | null): string | null {
  return userId === null ? null : (userLabels.get(userId) ?? null)
}
