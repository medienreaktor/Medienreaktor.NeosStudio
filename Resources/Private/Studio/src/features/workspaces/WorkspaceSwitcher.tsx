import { useMutation } from '@tanstack/react-query'
import { ApiError } from '@/api/client'
import { changeBaseWorkspace, type Workspace } from '@/api/workspaces'
import { queryKeys } from '@/api/keys'
import { queryClient } from '@/app/queryClient'
import { useStudio } from '@/app/StudioContext'
import { toast } from '@/components/ui/toast'
import { translate as t } from '@/lib/i18n'
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
 *   has publishable changes, surfaced as a hint to publish or discard first.
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
  const { workspaceContentChanged } = useStudio()
  const collaborative = activeWorkspace.name !== personalWorkspace.name

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

  const sharedTargets = targets.filter(
    (workspace) => workspace.classification === 'SHARED',
  )

  const items = [
    ...targets.map((workspace) => ({
      value: `base:${workspace.name}`,
      label: workspaceLabel(workspace),
    })),
    ...sharedTargets.map((workspace) => ({
      value: `edit:${workspace.name}`,
      label: `${workspaceLabel(workspace)}`,
    })),
  ]

  const onValueChange = (picked: string) => {
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
            collaborative
              ? t(
                  'workspace.collaborativeContext',
                  'Editing together in a shared workspace',
                )
              : t('workspace.publishTarget', 'Workspace to publish to')
          }
        >
          <div className="flex items-center gap-2">
            <i
              className={`fa fa-fw text-[0.7rem] ${
                switchBase.isPending
                  ? 'fa-spinner fa-spin text-neutral-400'
                  : collaborative
                    ? 'fa-users text-purple-500'
                    : 'fa-layer-group text-neutral-400'
              }`}
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
            {targets.map((workspace) => (
              <SelectItem
                key={`base:${workspace.name}`}
                value={`base:${workspace.name}`}
              >
                {workspaceLabel(workspace)}
                {/* No write access on the target = the user could retarget
                    here (that only needs read) but never publish. Selectable
                    for reviewing, but flagged. */}
                {!workspace.permissions.write && (
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
            ))}
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
        </SelectContent>
      </Select>
    </div>
  )
}
