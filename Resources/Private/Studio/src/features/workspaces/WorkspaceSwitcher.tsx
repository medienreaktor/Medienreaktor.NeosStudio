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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/**
 * Topbar dropdown choosing where the personal workspace publishes to - the
 * classic UI's workspace switcher. Editing always happens in the personal
 * workspace; picking an entry rebases it onto the chosen base (live or a
 * shared workspace). The content repository refuses the rebase while the
 * personal workspace still has publishable changes, which we surface as a
 * hint to publish or discard first.
 */
export function WorkspaceSwitcher({
  personalWorkspace,
  targets,
}: {
  personalWorkspace: Workspace
  /** Base workspaces on offer: live (ROOT) and shared ones. */
  targets: Workspace[]
}) {
  const { workspaceContentChanged } = useStudio()

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

  return (
    <div className="flex items-center gap-3">
      <Select
        // Controlled by the workspace list, so a failed switch snaps back.
        value={personalWorkspace.baseWorkspace ?? undefined}
        onValueChange={(v) => {
          // Re-selecting the current base is a no-op - the CR would reject
          // the redundant rebase with an error.
          if (v === personalWorkspace.baseWorkspace) return
          switchBase.mutate(v as string)
        }}
        disabled={switchBase.isPending}
        // Lets SelectValue render the label for the selected workspace name.
        items={targets.map((workspace) => ({
          value: workspace.name,
          label: workspaceLabel(workspace),
        }))}
      >
        <SelectTrigger
          title={t('workspace.publishTarget', 'Workspace to publish to')}
        >
          <div className="flex items-center gap-2">
            <i
              className={`fa fa-fw text-[0.7rem] text-neutral-400 ${switchBase.isPending ? 'fa-spinner fa-spin' : 'fa-code-branch'}`}
              aria-hidden
            />
            <SelectValue
              placeholder={t(
                'workspace.selectPlaceholder',
                'Select workspace…',
              )}
            />
          </div>
        </SelectTrigger>
        <SelectContent>
          {targets.map((workspace) => (
            <SelectItem key={workspace.name} value={workspace.name}>
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
        </SelectContent>
      </Select>
    </div>
  )
}
