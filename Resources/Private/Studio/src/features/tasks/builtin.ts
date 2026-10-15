import { panelRegistry } from '@/features/panels/registry'
import { workspaceDecoratorRegistry } from '@/features/workspaces/decorators'
import { translate as t } from '@/lib/i18n'
import { knownUserLabel, taskOfWorkspace } from './decorationData'
import { taskStatusColor } from './status'
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
      // The task list snapshot (decorationData.ts) - kept current by
      // useTaskDecorationData(), which also re-emits the registry.
      const task = taskOfWorkspace(workspace.name)
      if (!task) return null
      const assigneeLabel = knownUserLabel(task.assignee)

      const status =
        task.status === 'IN_REVIEW'
          ? t('tasks.statusInReview', 'in review')
          : task.status === 'DONE'
            ? t('tasks.statusDone', 'done')
            : t('tasks.statusOpen', 'open')
      const label = [
        t('tasks.taskBranch', 'Task branch'),
        status,
        assigneeLabel
          ? t('tasks.assignedTo', 'Assigned to {0}', [assigneeLabel])
          : null,
      ]
        .filter(Boolean)
        .join(' · ')

      return {
        // The badge IS the status, in the status color (see status.ts).
        badge: status,
        icon: 'code-branch',
        color: taskStatusColor(task.status),
        label,
        switcherGroup: t('tasks.switcherGroup', 'Tasks'),
      }
    },
  })
}
