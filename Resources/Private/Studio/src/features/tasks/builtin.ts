import { taskOf } from '@/api/tasks'
import { panelRegistry } from '@/features/panels/registry'
import { workspaceDecoratorRegistry } from '@/features/workspaces/decorators'
import { translate as t } from '@/lib/i18n'
import { TasksBoard } from './TasksBoard'

/**
 * The built-in task workflow: the Tasks board as a main-region tab (after the
 * other built-ins) and the workspace decorator that badges task/feature
 * branches everywhere workspaces are listed - including their own
 * "Tasks & Features" group in the workspace switcher.
 */
export function registerBuiltinTaskWorkflow(): void {
  panelRegistry.register({
    id: 'tasks',
    title: t('panel.title.tasks', 'Tasks'),
    component: TasksBoard,
    defaultPlacement: { kind: 'dock', region: 'main' },
  })

  workspaceDecoratorRegistry.register({
    id: 'tasks',
    decorate: (workspace) => {
      const task = taskOf(workspace)
      if (!task) return null

      const status =
        task.status === 'IN_REVIEW'
          ? t('tasks.statusInReview', 'in review')
          : task.status === 'DONE'
            ? t('tasks.statusDone', 'done')
            : t('tasks.statusOpen', 'open')
      const label = [
        t('tasks.taskBranch', 'Task branch'),
        status,
        task.assigneeLabel
          ? t('tasks.assignedTo', 'Assigned to {0}', [task.assigneeLabel])
          : null,
        task.ticketReference,
      ]
        .filter(Boolean)
        .join(' · ')

      return {
        // The badge IS the status, in the status color: open = red (work to
        // do), in review = orange (waiting on a reviewer), done = green.
        badge: status,
        icon: 'code-branch',
        color:
          task.status === 'DONE'
            ? '#4ade80'
            : task.status === 'IN_REVIEW'
              ? '#fb923c'
              : '#f87171',
        label,
        switcherGroup: t('tasks.switcherGroup', 'Tasks'),
      }
    },
  })
}
