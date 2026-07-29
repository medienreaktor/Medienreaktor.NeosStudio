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

      const feature = task.type === 'FEATURE'
      const status =
        task.status === 'IN_REVIEW'
          ? t('tasks.statusInReview', 'in review')
          : task.status === 'DONE'
            ? t('tasks.statusDone', 'done')
            : t('tasks.statusOpen', 'open')
      const label = [
        feature
          ? t('tasks.featureBranch', 'Feature branch')
          : t('tasks.taskBranch', 'Task branch'),
        status,
        task.assigneeLabel
          ? t('tasks.assignedTo', 'Assigned to {0}', [task.assigneeLabel])
          : null,
        task.ticketReference,
      ]
        .filter(Boolean)
        .join(' · ')

      return {
        badge: task.type,
        icon: feature ? 'code-branch' : 'clipboard-check',
        // amber for tasks, emerald for feature branches; a review-ready
        // branch turns blue so reviewers spot it in any listing.
        color:
          task.status === 'IN_REVIEW'
            ? '#60a5fa'
            : feature
              ? '#34d399'
              : '#fbbf24',
        label,
        switcherGroup: t('tasks.switcherGroup', 'Tasks & Features'),
      }
    },
  })
}
