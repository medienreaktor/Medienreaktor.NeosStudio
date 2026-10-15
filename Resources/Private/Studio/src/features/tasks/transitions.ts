import type { Task, TaskStatus } from '@/api/studio/schema'

/**
 * Which columns a task may be dragged to by the current account - mirroring
 * the server's rules so invalid drops never start:
 *
 * - OPEN -> IN_REVIEW (submit) and IN_REVIEW -> OPEN (reopen) need write
 *   access on the task workspace (assignee or manager). A DONE task can only
 *   be reopened, never re-submitted.
 * - -> DONE opens the review flow (publish selected changes, then complete),
 *   which needs manage (creator/reviewers) plus publish rights on the base
 *   (task.canPublish).
 */
export function allowedTargets(task: Task): TaskStatus[] {
  const permissions = task.workspace?.permissions
  if (!permissions) return []
  const targets: TaskStatus[] = []
  if (permissions.write && task.status !== 'OPEN') targets.push('OPEN')
  if (permissions.write && task.status === 'OPEN') targets.push('IN_REVIEW')
  if (permissions.manage && task.canPublish && task.status !== 'DONE') {
    targets.push('DONE')
  }
  return targets
}
