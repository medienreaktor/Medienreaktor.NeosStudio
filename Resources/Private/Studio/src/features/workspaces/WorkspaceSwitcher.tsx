import * as React from 'react'
import { useMutation } from '@tanstack/react-query'
import { ApiError, apiErrorDescription } from '@/api/client'
import { taskOf, transitionTask, type TaskStatus } from '@/api/tasks'
import {
  changeBaseWorkspace,
  useWorkspaces,
  type Workspace,
} from '@/api/workspaces'
import { queryKeys } from '@/api/keys'
import { queryClient } from '@/app/queryClient'
import { useStudio } from '@/app/StudioContext'
import { toast } from '@/components/ui/toast'
import { translate as t } from '@/lib/i18n'
import { CreateTaskDialog } from '@/features/tasks/CreateTaskDialog'
import { ReviewChangesDialog } from '@/features/workspaces/ReviewChangesDialog'
import {
  decorationsFor,
  useWorkspaceDecorators,
} from '@/features/workspaces/decorators'
import { WorkspaceDecorationBadges } from '@/features/workspaces/WorkspaceDecorationBadges'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/**
 * Topbar dropdown for the editing context, with two kinds of entries:
 *
 * - Publish targets (the classic model): editing happens in the personal
 *   workspace; picking Live or a shared workspace rebases the personal
 *   workspace onto it and thereby retargets where a publish goes. The
 *   content repository refuses the rebase while the personal workspace still
 *   has publishable changes, so those entries are disabled until the user
 *   publishes or discards (the server error stays as a race fallback).
 *
 * - Collaborative sessions: every shared workspace additionally offers a
 *   "Collaborative" entry that moves the EDITING context into that workspace
 *   itself - commands then run directly against it, together with everyone
 *   else editing there (Studio's multiplayer mode). This is a pure
 *   client-side switch: no rebase, no empty-workspace requirement, pending
 *   personal changes stay untouched.
 */
export function WorkspaceSwitcher({
  personalWorkspace,
  activeWorkspace,
  targets,
  onSwitchEditingContext,
}: {
  personalWorkspace: Workspace
  /** The workspace being edited: personal, or a shared one (collaborative). */
  activeWorkspace: Workspace
  /** Base workspaces on offer: live (ROOT) and shared ones. */
  targets: Workspace[]
  /** Move the editing context to a shared workspace, or null = personal. */
  onSwitchEditingContext: (workspaceName: string | null) => void
}) {
  const { workspaceContentChanged, navigateToNodeInWorkspace } = useStudio()
  const collaborative = activeWorkspace.name !== personalWorkspace.name
  const [creatingTask, setCreatingTask] = React.useState(false)
  const [reviewing, setReviewing] = React.useState(false)
  // The full readable list for the review dialog (the `targets` prop is only
  // the base-workspace subset).
  const { data: workspacesData } = useWorkspaces()

  // Workflow actions for the checked-out task branch (see the entries at the
  // bottom of the dropdown): submit / reopen transition directly, completing
  // routes through the review dialog while changes are pending - the same
  // semantics as the Tasks board.
  const activeTask = taskOf(activeWorkspace)
  const taskTransition = useMutation({
    mutationFn: (target: TaskStatus) =>
      transitionTask(activeWorkspace.name, target),
    onSuccess: (_response, target) => {
      toast.success(
        target === 'IN_REVIEW'
          ? t('tasks.submitted', 'The task has been submitted for review.')
          : target === 'DONE'
            ? t('tasks.completed', 'The task has been completed.')
            : t('tasks.reopenedToast', 'The task has been reopened.'),
      )
    },
    onError: (error) =>
      toast.error(
        apiErrorDescription(
          error,
          t('tasks.moveFailedDetail', 'Moving the task failed.'),
        ),
        { title: t('tasks.moveFailed', 'Could not move task') },
      ),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks })
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all })
    },
  })

  const switchBase = useMutation({
    mutationFn: (baseWorkspace: string) =>
      changeBaseWorkspace(personalWorkspace.name, baseWorkspace),
    onSuccess: () => {
      // The workspace list carries the baseWorkspace shown as the selected
      // value, and every cached node read is stale - unchanged nodes now
      // show the new base's content.
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.nodes.all })
      workspaceContentChanged()
      toast.success(t('workspace.switched', 'Workspace switched.'))
    },
    onError: (error) => {
      // The CR refuses the rebase while the personal workspace still has
      // publishable changes — guide the user to clear them first.
      const notEmpty =
        error instanceof ApiError &&
        (error.body as { error?: string } | null)?.error ===
          'workspace_not_empty'
      toast.error(
        notEmpty
          ? t(
              'workspace.publishOrDiscardFirst',
              'Publish or discard your changes first.',
            )
          : error,
        {
          title: t('workspace.switchFailed', 'Switching the workspace failed'),
        },
      )
    },
  })

  const workspaceLabel = (workspace: Workspace) =>
    workspace.classification === 'ROOT'
      ? t('workspace.live', 'Live')
      : workspace.title || workspace.name

  // Values are namespaced: "base:x" rebases the personal workspace onto x,
  // "edit:x" moves the editing context into the shared workspace x.
  const value = collaborative
    ? `edit:${activeWorkspace.name}`
    : personalWorkspace.baseWorkspace
      ? `base:${personalWorkspace.baseWorkspace}`
      : undefined

  // Decorators can claim a workspace for a dedicated group (e.g. a task
  // workflow's "Tasks & Features"): claimed workspaces leave the standard
  // publish-target/collaborative entries and appear as checkout entries in
  // their own labeled group below. The current base workspace is never
  // claimed away - it is the selected value.
  const decorators = useWorkspaceDecorators()
  const groupOf = (workspace: Workspace): string | null =>
    workspace.name === personalWorkspace.baseWorkspace
      ? null
      : (decorationsFor(workspace, decorators).find(
          (decoration) => decoration.switcherGroup,
        )?.switcherGroup ?? null)

  const standardTargets = targets.filter((workspace) => !groupOf(workspace))
  const sharedTargets = standardTargets.filter(
    (workspace) => workspace.classification === 'SHARED',
  )

  // Tint the whole trigger by the editing context: purple for a plain
  // collaborative workspace (matching the multiplayer icon), a decorated
  // workspace's own color (e.g. the task status color) when it brings one.
  const activeDecoration = collaborative
    ? (decorationsFor(activeWorkspace, decorators)[0] ?? null)
    : null
  const tint = collaborative ? (activeDecoration?.color ?? '#a855f7') : null
  const decoratorGroups = new Map<string, Workspace[]>()
  for (const workspace of targets) {
    const group = groupOf(workspace)
    if (!group) continue
    decoratorGroups.set(group, [...(decoratorGroups.get(group) ?? []), workspace])
  }

  const items = [
    ...standardTargets.map((workspace) => ({
      value: `base:${workspace.name}`,
      label: workspaceLabel(workspace),
    })),
    ...sharedTargets.map((workspace) => ({
      value: `edit:${workspace.name}`,
      label: `${workspaceLabel(workspace)}`,
    })),
    ...[...decoratorGroups.values()].flat().map((workspace) => ({
      value: `edit:${workspace.name}`,
      label: workspaceLabel(workspace),
    })),
  ]

  const onValueChange = (picked: string) => {
    if (picked === value) return
    // Action entries never change the selection - they trigger a workflow
    // step or open a dialog.
    if (picked === 'action:new-task') {
      setCreatingTask(true)
      return
    }
    if (picked === 'action:task-submit') {
      taskTransition.mutate('IN_REVIEW')
      return
    }
    if (picked === 'action:task-reopen') {
      taskTransition.mutate('OPEN')
      return
    }
    if (picked === 'action:task-complete') {
      // Pending changes: the reviewer picks what to publish first; the task
      // completes after the publish. Nothing pending: complete directly.
      if (activeWorkspace.hasPublishableChanges) setReviewing(true)
      else taskTransition.mutate('DONE')
      return
    }
    if (picked.startsWith('edit:')) {
      onSwitchEditingContext(picked.slice('edit:'.length))
      return
    }
    const baseWorkspace = picked.slice('base:'.length)
    // A base target always means "edit in my workspace again" first; the
    // rebase only runs when the target differs from the current base.
    if (collaborative) onSwitchEditingContext(null)
    if (baseWorkspace !== personalWorkspace.baseWorkspace) {
      switchBase.mutate(baseWorkspace)
    }
  }

  return (
    <div className="flex items-center gap-3">
      <Select
        // Controlled by the workspace list + editing context, so a failed
        // switch snaps back.
        value={value}
        onValueChange={(v) => onValueChange(v as string)}
        disabled={switchBase.isPending}
        // Lets SelectValue render the label for the selected entry.
        items={items}
      >
        <SelectTrigger
          title={
            activeDecoration?.label ??
            (collaborative
              ? t(
                  'workspace.collaborativeContext',
                  'Editing together in a shared workspace',
                )
              : t('workspace.publishTarget', 'Workspace to publish to'))
          }
          style={tint ? { borderColor: tint, color: tint } : undefined}
        >
          <div className="flex items-center gap-2">
            <i
              className={`fa fa-fw text-[0.7rem] ${
                switchBase.isPending
                  ? 'fa-spinner fa-spin text-neutral-400'
                  : activeDecoration
                    ? `fa-${activeDecoration.icon ?? 'code-branch'}`
                    : collaborative
                      ? 'fa-users'
                      : 'fa-layer-group text-neutral-400'
              }`}
              style={tint && !switchBase.isPending ? { color: tint } : undefined}
              aria-hidden
            />
            <SelectValue
              className="hidden @[48rem]:inline"
              placeholder={t(
                'workspace.selectPlaceholder',
                'Select workspace…',
              )}
            />
          </div>
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>
              {t('workspace.publishTargetGroup', 'My workspace, publishing to')}
            </SelectLabel>
            {standardTargets.map((workspace) => {
              // Changing the base rebases the personal workspace, which the
              // CR refuses while it still holds publishable changes. The
              // current base stays enabled: it is the selected value, and in
              // collaborative mode it is the rebase-free way back to editing
              // the personal workspace.
              const rebaseBlocked =
                personalWorkspace.hasPublishableChanges &&
                workspace.name !== personalWorkspace.baseWorkspace
              return (
                <SelectItem
                  key={`base:${workspace.name}`}
                  value={`base:${workspace.name}`}
                  disabled={rebaseBlocked}
                >
                  {workspaceLabel(workspace)}
                  <WorkspaceDecorationBadges workspace={workspace} />
                  {rebaseBlocked && (
                    <span className="ml-1.5 text-xs text-neutral-400">
                      {t(
                        'workspace.publishOrDiscardFirst',
                        'Publish or discard your changes first.',
                      )}
                    </span>
                  )}
                  {/* No write access on the target = the user could retarget
                      here (that only needs read) but never publish. Selectable
                      for reviewing, but flagged. */}
                  {!rebaseBlocked && !workspace.permissions.write && (
                    <span
                      className="ml-1.5 text-xs text-neutral-400"
                      title={t(
                        'workspace.cannotPublishHere',
                        'You cannot publish to this workspace',
                      )}
                    >
                      <i className="fas fa-lock" aria-hidden />{' '}
                      {t('workspace.readOnly', 'read-only')}
                    </span>
                  )}
                </SelectItem>
              )
            })}
          </SelectGroup>
          {sharedTargets.length > 0 && (
            <>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel>
                  {t(
                    'workspace.collaborativeGroup',
                    'Collaborative editing (with everyone in the workspace)',
                  )}
                </SelectLabel>
                {sharedTargets.map((workspace) => (
                  <SelectItem
                    key={`edit:${workspace.name}`}
                    value={`edit:${workspace.name}`}
                    // Editing directly in the workspace needs write access.
                    disabled={!workspace.permissions.write}
                  >
                    <i
                      className="fas fa-users text-[0.7rem] text-purple-500"
                      aria-hidden
                    />
                    {workspaceLabel(workspace)}
                    <WorkspaceDecorationBadges workspace={workspace} />
                    {!workspace.permissions.write && (
                      <span className="ml-1.5 text-xs text-neutral-400">
                        <i className="fas fa-lock" aria-hidden />{' '}
                        {t('workspace.readOnly', 'read-only')}
                      </span>
                    )}
                  </SelectItem>
                ))}
              </SelectGroup>
            </>
          )}
          {[...decoratorGroups.entries()].map(([group, workspaces]) => (
            <React.Fragment key={`group:${group}`}>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel>{group}</SelectLabel>
                {workspaces.map((workspace) => {
                  const decoration =
                    decorationsFor(workspace, decorators)[0] ?? null
                  return (
                    <SelectItem
                      key={`edit:${workspace.name}`}
                      value={`edit:${workspace.name}`}
                      // Checking the workspace out means editing in it
                      // directly, which needs write access.
                      disabled={!workspace.permissions.write}
                    >
                      {/* Leading icon like the multiplayer entries, in the
                          decoration's (status) color. */}
                      <i
                        className={`fas fa-${decoration?.icon ?? 'code-branch'} text-[0.7rem]`}
                        style={
                          decoration?.color
                            ? { color: decoration.color }
                            : undefined
                        }
                        aria-hidden
                      />
                      {workspaceLabel(workspace)}
                      <WorkspaceDecorationBadges workspace={workspace} />
                      {!workspace.permissions.write && (
                        <span className="ml-1.5 text-xs text-neutral-400">
                          <i className="fas fa-lock" aria-hidden />{' '}
                          {t('workspace.readOnly', 'read-only')}
                        </span>
                      )}
                    </SelectItem>
                  )
                })}
              </SelectGroup>
            </React.Fragment>
          ))}
          {activeTask && (
            <>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel>
                  {t('tasks.currentTaskGroup', 'Current task: {0}', [
                    activeWorkspace.title || activeWorkspace.name,
                  ])}
                </SelectLabel>
                {activeTask.status === 'OPEN' &&
                  activeWorkspace.permissions.write && (
                    <SelectItem value="action:task-submit">
                      <i
                        className="fas fa-paper-plane text-[0.7rem]"
                        aria-hidden
                      />
                      {t('tasks.sendToReview', 'Send to review')}
                    </SelectItem>
                  )}
                {activeTask.status !== 'DONE' &&
                  activeWorkspace.permissions.manage &&
                  activeWorkspace.permissions.publish && (
                    <SelectItem value="action:task-complete">
                      <i className="fas fa-check text-[0.7rem]" aria-hidden />
                      {t('tasks.completeTask', 'Complete task')}
                    </SelectItem>
                  )}
                {activeTask.status !== 'OPEN' &&
                  activeWorkspace.permissions.write && (
                    <SelectItem value="action:task-reopen">
                      <i
                        className="fas fa-rotate-left text-[0.7rem]"
                        aria-hidden
                      />
                      {t('tasks.reopenTask', 'Reopen task')}
                    </SelectItem>
                  )}
              </SelectGroup>
            </>
          )}
          <SelectSeparator />
          <SelectGroup>
            <SelectItem value="action:new-task">
              <i className="fas fa-plus text-[0.7rem]" aria-hidden />
              {t('tasks.addTaskWorkspace', 'Add task workspace …')}
            </SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
      {reviewing && workspacesData && (
        <ReviewChangesDialog
          workspaces={workspacesData.workspaces}
          activeWorkspace={activeWorkspace}
          initialSourceName={activeWorkspace.name}
          open={reviewing}
          onOpenChange={(open) => !open && setReviewing(false)}
          onNavigate={navigateToNodeInWorkspace}
          onPublished={(sourceWorkspaceName) => {
            if (sourceWorkspaceName === activeWorkspace.name) {
              taskTransition.mutate('DONE')
              setReviewing(false)
            }
          }}
        />
      )}
      <CreateTaskDialog
        open={creatingTask}
        onOpenChange={setCreatingTask}
        // Check the fresh branch out right away - creating a task from the
        // switcher means "I want to work in it now".
        onCreated={(task) => onSwitchEditingContext(task.workspaceName)}
      />
    </div>
  )
}
