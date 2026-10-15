import { createContext, useContext, useState, type ReactNode } from 'react'
import { canPublish, useWorkspaces } from '@/api/neos/endpoints/workspaces'
import type { Workspace } from '@/api/neos/schema'
import { useStudioActions } from '@/app/StudioContext'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { ReviewChangesDialog } from '@/features/workspaces/ReviewChangesDialog'
import type { WorkspaceSwitcherExtension } from '@/features/workspaces/decorators'
import { translate as t } from '@/lib/i18n'
import { CreateTaskDialog } from './CreateTaskDialog'
import { taskOfWorkspace } from './decorationData'
import { SendToReviewDialog } from './SendToReviewDialog'
import { useTaskTransition } from './useTaskTransition'

/**
 * The task workflow in the workspace switcher (its decorator's switcher
 * extension, see builtin.ts): the checked-out task branch's actions - send to
 * review, complete, reopen - as the submenu of its entry, and "Add task
 * workspace" at the end of the menu. The same semantics as the Tasks board:
 * completing routes through the review dialog while changes are pending.
 */

interface TaskSwitcherContext {
  submit: () => void
  complete: (workspace: Workspace) => void
  reopen: (workspace: Workspace) => void
  create: () => void
}

const Context = createContext<TaskSwitcherContext | null>(null)

/** The dialogs the menu items open, mounted with the switcher. */
function TaskSwitcherProvider({
  activeWorkspace,
  onCheckout,
  children,
}: {
  activeWorkspace: Workspace
  onCheckout: (workspaceName: string) => void
  children: ReactNode
}) {
  const { navigateToNodeInWorkspace } = useStudioActions()
  // The full readable list for the review dialog
  const { data: workspaces } = useWorkspaces()
  const transition = useTaskTransition()
  const [creating, setCreating] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const context: TaskSwitcherContext = {
    submit: () => setSubmitting(true),
    complete: transition.complete,
    reopen: (workspace) =>
      transition.transition({ workspaceName: workspace.name, target: 'OPEN' }),
    create: () => setCreating(true),
  }

  return (
    <Context.Provider value={context}>
      {children}
      <CreateTaskDialog
        open={creating}
        onOpenChange={setCreating}
        // Check the fresh branch out right away - creating a task from the
        // switcher means "I want to work in it now".
        onCreated={(task) => onCheckout(task.workspaceName)}
      />
      <SendToReviewDialog
        open={submitting}
        onOpenChange={setSubmitting}
        pending={transition.isPending}
        onSubmit={(comment) =>
          transition.transition(
            {
              workspaceName: activeWorkspace.name,
              target: 'IN_REVIEW',
              comment: comment || undefined,
            },
            { onSuccess: () => setSubmitting(false) },
          )
        }
      />
      {transition.reviewing !== null && workspaces && (
        <ReviewChangesDialog
          workspaces={workspaces}
          activeWorkspace={activeWorkspace}
          initialSourceName={transition.reviewing}
          open
          onOpenChange={(open) => !open && transition.cancelReview()}
          onNavigate={navigateToNodeInWorkspace}
          onPublished={transition.published}
        />
      )}
    </Context.Provider>
  )
}

function useTaskSwitcher(): TaskSwitcherContext {
  const context = useContext(Context)
  if (context === null) {
    throw new Error('Task switcher items need the TaskSwitcherProvider')
  }
  return context
}

/** The checked-out task branch's workflow actions, by its status. */
function TaskSwitcherActions({ workspace }: { workspace: Workspace }) {
  const actions = useTaskSwitcher()
  const { data: workspaces } = useWorkspaces()
  const task = taskOfWorkspace(workspace.name)
  if (task === null) return null
  return (
    <>
      {task.status === 'OPEN' && workspace.permissions.write && (
        <DropdownMenuItem onClick={actions.submit}>
          <i className="fas fa-paper-plane w-4 text-center" aria-hidden />
          {t('tasks.sendToReview', 'Send to review')}
        </DropdownMenuItem>
      )}
      {task.status !== 'DONE' &&
        workspace.permissions.manage &&
        canPublish(workspace, workspaces ?? []) && (
          <DropdownMenuItem onClick={() => actions.complete(workspace)}>
            <i className="fas fa-check w-4 text-center" aria-hidden />
            {t('tasks.completeTask', 'Complete task')}
          </DropdownMenuItem>
        )}
      {task.status !== 'OPEN' && workspace.permissions.write && (
        <DropdownMenuItem onClick={() => actions.reopen(workspace)}>
          <i className="fas fa-rotate-left w-4 text-center" aria-hidden />
          {t('tasks.reopenTask', 'Reopen task')}
        </DropdownMenuItem>
      )}
    </>
  )
}

function TaskSwitcherMenuItems() {
  const actions = useTaskSwitcher()
  return (
    <DropdownMenuItem onClick={actions.create}>
      <i className="fas fa-plus text-[0.7rem]" aria-hidden />
      {t('tasks.addTaskWorkspace', 'Add task workspace')}
    </DropdownMenuItem>
  )
}

export const taskSwitcherExtension: WorkspaceSwitcherExtension = {
  Provider: TaskSwitcherProvider,
  Actions: TaskSwitcherActions,
  MenuItems: TaskSwitcherMenuItems,
}
