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
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { toast } from '@/components/ui/toast'
import { translate as t } from '@/lib/i18n'
import { CreateTaskDialog } from '@/features/tasks/CreateTaskDialog'
import { ReviewChangesDialog } from '@/features/workspaces/ReviewChangesDialog'
import {
  decorationsFor,
  useWorkspaceDecorators,
} from '@/features/workspaces/decorators'
import { WorkspaceDecorationBadges } from '@/features/workspaces/WorkspaceDecorationBadges'

/**
 * The darkest ramp shade of a tint, used as the trigger background: theme
 * variables like 'var(--color-blue-500)' map onto their ramp's 950 shade,
 * arbitrary decoration colors approximate it by mixing into near-black.
 */
function darkestShade(tint: string): string {
  const ramp = tint.match(/^var\(--color-([a-z]+)-\d{2,3}\)$/)
  return ramp
    ? `var(--color-${ramp[1]}-950)`
    : `color-mix(in srgb, ${tint} 20%, var(--color-neutral-950))`
}

/**
 * Topbar dropdown for the editing context - a menu (not a select) so the
 * checked-out task branch can nest its workflow actions as a submenu. Entry
 * kinds:
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
 *
 * - Decorator groups (e.g. "Tasks"): checkout entries for decorated
 *   workspaces. The ACTIVE task's entry becomes a submenu carrying the
 *   status-dependent workflow actions (send to review / complete / reopen).
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

  // Workflow actions for the checked-out task branch (the submenu on its
  // entry): submit / reopen transition directly, completing routes through
  // the review dialog while changes are pending - the same semantics as the
  // Tasks board.
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

  const completeTask = () => {
    // Pending changes: the reviewer picks what to publish first; the task
    // completes after the publish. Nothing pending: complete directly.
    if (activeWorkspace.hasPublishableChanges) setReviewing(true)
    else taskTransition.mutate('DONE')
  }

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
  // workflow's "Tasks"): claimed workspaces leave the standard
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
  const decoratorGroups = new Map<string, Workspace[]>()
  for (const workspace of targets) {
    const group = groupOf(workspace)
    if (!group) continue
    decoratorGroups.set(group, [
      ...(decoratorGroups.get(group) ?? []),
      workspace,
    ])
  }

  // Tint the whole trigger by the editing context: purple for a plain
  // collaborative workspace (matching the multiplayer icon), a decorated
  // workspace's own color (e.g. the task status color) when it brings one.
  const activeDecoration = collaborative
    ? (decorationsFor(activeWorkspace, decorators)[0] ?? null)
    : null
  const tint = collaborative
    ? (activeDecoration?.color ?? 'var(--color-purple-400)')
    : null

  const currentLabel = collaborative
    ? workspaceLabel(activeWorkspace)
    : personalWorkspace.baseWorkspace
      ? workspaceLabel(
          targets.find(
            (workspace) => workspace.name === personalWorkspace.baseWorkspace,
          ) ?? personalWorkspace,
        )
      : t('workspace.selectPlaceholder', 'Select workspace…')

  const pick = (picked: string) => {
    if (picked === value) return
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
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={switchBase.isPending}
          title={
            activeDecoration?.label ??
            (collaborative
              ? t(
                  'workspace.collaborativeContext',
                  'Editing together in a shared workspace',
                )
              : t('workspace.publishTarget', 'Workspace to publish to'))
          }
          style={
            tint
              ? {
                  borderColor: tint,
                  color: tint,
                  backgroundColor: darkestShade(tint),
                }
              : undefined
          }
          className="flex h-9 w-fit items-center justify-between gap-2 rounded-md border border-neutral-700 bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-blue-500 focus-visible:ring-[3px] focus-visible:ring-blue-500/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-neutral-700/30 dark:hover:bg-neutral-700/50"
        >
          <span className="flex items-center gap-2">
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
              style={
                tint && !switchBase.isPending ? { color: tint } : undefined
              }
              aria-hidden
            />
            <span className="hidden @[48rem]:inline">{currentLabel}</span>
          </span>
          <i
            className="fas fa-chevron-down text-[1rem] text-white/50"
            aria-hidden
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-64">
          <DropdownMenuGroup>
            <DropdownMenuLabel>
              {t('workspace.publishTargetGroup', 'My workspace, publishing to')}
            </DropdownMenuLabel>
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
                <DropdownMenuCheckboxItem
                  key={`base:${workspace.name}`}
                  checked={value === `base:${workspace.name}`}
                  closeOnClick
                  disabled={rebaseBlocked}
                  onClick={() => pick(`base:${workspace.name}`)}
                >
                  {workspaceLabel(workspace)}
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
                </DropdownMenuCheckboxItem>
              )
            })}
          </DropdownMenuGroup>
          {sharedTargets.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>
                  {t(
                    'workspace.collaborativeGroup',
                    'Collaborative editing (with everyone in the workspace)',
                  )}
                </DropdownMenuLabel>
                {sharedTargets.map((workspace) => (
                  <DropdownMenuCheckboxItem
                    key={`edit:${workspace.name}`}
                    checked={value === `edit:${workspace.name}`}
                    closeOnClick
                    // Editing directly in the workspace needs write access.
                    disabled={!workspace.permissions.write}
                    onClick={() => pick(`edit:${workspace.name}`)}
                  >
                    <i
                      className="fas fa-users text-[0.7rem] text-purple-500"
                      aria-hidden
                    />
                    {workspaceLabel(workspace)}
                    {!workspace.permissions.write && (
                      <span className="ml-1.5 text-xs text-neutral-400">
                        <i className="fas fa-lock" aria-hidden />{' '}
                        {t('workspace.readOnly', 'read-only')}
                      </span>
                    )}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuGroup>
            </>
          )}
          {[...decoratorGroups.entries()].map(([group, workspaces]) => (
            <React.Fragment key={`group:${group}`}>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>{group}</DropdownMenuLabel>
                {workspaces.map((workspace) => {
                  const decoration =
                    decorationsFor(workspace, decorators)[0] ?? null
                  const icon = (
                    <i
                      className={`fas fa-${decoration?.icon ?? 'code-branch'} text-[0.7rem]`}
                      style={
                        decoration?.color
                          ? { color: decoration.color }
                          : undefined
                      }
                      aria-hidden
                    />
                  )
                  const isActiveTask =
                    activeTask !== null &&
                    workspace.name === activeWorkspace.name
                  // The checked-out task nests its workflow actions as a
                  // submenu; the other entries check the workspace out.
                  if (isActiveTask) {
                    return (
                      <DropdownMenuSub key={`edit:${workspace.name}`}>
                        <DropdownMenuSubTrigger className="pl-8">
                          <span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
                            <i
                              className="fas fa-check text-[0.65rem]"
                              aria-hidden
                            />
                          </span>
                          {icon}
                          {workspaceLabel(workspace)}
                          <WorkspaceDecorationBadges workspace={workspace} />
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                          {activeTask.status === 'OPEN' &&
                            activeWorkspace.permissions.write && (
                              <DropdownMenuItem
                                onClick={() =>
                                  taskTransition.mutate('IN_REVIEW')
                                }
                              >
                                <i
                                  className="fas fa-paper-plane w-4 text-center"
                                  aria-hidden
                                />
                                {t('tasks.sendToReview', 'Send to review')}
                              </DropdownMenuItem>
                            )}
                          {activeTask.status !== 'DONE' &&
                            activeWorkspace.permissions.manage &&
                            activeWorkspace.permissions.publish && (
                              <DropdownMenuItem onClick={completeTask}>
                                <i
                                  className="fas fa-check w-4 text-center"
                                  aria-hidden
                                />
                                {t('tasks.completeTask', 'Complete task')}
                              </DropdownMenuItem>
                            )}
                          {activeTask.status !== 'OPEN' &&
                            activeWorkspace.permissions.write && (
                              <DropdownMenuItem
                                onClick={() => taskTransition.mutate('OPEN')}
                              >
                                <i
                                  className="fas fa-rotate-left w-4 text-center"
                                  aria-hidden
                                />
                                {t('tasks.reopenTask', 'Reopen task')}
                              </DropdownMenuItem>
                            )}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    )
                  }
                  return (
                    <DropdownMenuCheckboxItem
                      key={`edit:${workspace.name}`}
                      checked={value === `edit:${workspace.name}`}
                      closeOnClick
                      // Checking the workspace out means editing in it
                      // directly, which needs write access.
                      disabled={!workspace.permissions.write}
                      onClick={() => pick(`edit:${workspace.name}`)}
                    >
                      {icon}
                      {workspaceLabel(workspace)}
                      <WorkspaceDecorationBadges workspace={workspace} />
                      {!workspace.permissions.write && (
                        <span className="ml-1.5 text-xs text-neutral-400">
                          <i className="fas fa-lock" aria-hidden />{' '}
                          {t('workspace.readOnly', 'read-only')}
                        </span>
                      )}
                    </DropdownMenuCheckboxItem>
                  )
                })}
              </DropdownMenuGroup>
            </React.Fragment>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => setCreatingTask(true)}>
              <i className="fas fa-plus text-[0.7rem]" aria-hidden />
              {t('tasks.addTaskWorkspace', 'Add task workspace')}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateTaskDialog
        open={creatingTask}
        onOpenChange={setCreatingTask}
        // Check the fresh branch out right away - creating a task from the
        // switcher means "I want to work in it now".
        onCreated={(task) => onSwitchEditingContext(task.workspaceName)}
      />
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
    </div>
  )
}
