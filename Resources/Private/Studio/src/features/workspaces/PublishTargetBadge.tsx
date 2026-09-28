import { useWorkspaces, type Workspace } from '@/api/workspaces'
import { Badge } from '@/components/ui/badge'
import { translate as t } from '@/lib/i18n'
import { workspaceIconName } from './WorkspaceIcon'

/**
 * Where a publish from the given (checked-out) workspace goes: its base
 * workspace, looked up in the full readable list - a task branch may sit on a
 * workspace outside the switcher's targets. Falls back to the raw name while
 * the list loads or when the base is not readable.
 */
export function usePublishTarget(workspace: Workspace): {
  label: string
  icon: string
  /** The base's classification, null while unresolved. */
  classification: string | null
} {
  const { data } = useWorkspaces()
  const base = workspace.baseWorkspace
    ? (data?.workspaces.find(
        (candidate) => candidate.name === workspace.baseWorkspace,
      ) ?? null)
    : null
  return {
    label: base
      ? base.classification === 'ROOT'
        ? t('workspace.live', 'Live')
        : base.title || base.name
      : (workspace.baseWorkspace ??
        t('workspace.selectPlaceholder', 'Select workspace…')),
    icon: workspaceIconName(base ?? undefined),
    classification: base?.classification ?? null,
  }
}

/**
 * Pill colors by the target's classification: Neos primary blue for live
 * (ROOT), Neos purple for every other target (shared workspaces, or a base not
 * resolved yet). Fixed in both color schemes - the pill sits on a neutral
 * trigger either way.
 */
const LIVE_TARGET_STYLE =
  'bg-blue-500 text-white dark:bg-blue-500 dark:text-white'
const OTHER_TARGET_STYLE =
  'bg-purple-500 text-white dark:bg-purple-500 dark:text-white'

/**
 * "→ target" pill naming the publish target of a workspace. The label
 * collapses with the topbar (icon only).
 */
export function PublishTargetBadge({ workspace }: { workspace: Workspace }) {
  const { label, icon, classification } = usePublishTarget(workspace)
  const style =
    classification === 'ROOT' ? LIVE_TARGET_STYLE : OTHER_TARGET_STYLE
  return (
    <Badge variant="secondary" className={`gap-1.5 font-normal ${style}`}>
      <i className="fas fa-arrow-right text-[0.6rem] text-white" aria-hidden />
      <i
        className={`fas fa-fw ${icon} text-[0.65rem] text-white`}
        aria-hidden
      />
      <span className="hidden @[56rem]:inline max-w-40 truncate">{label}</span>
    </Badge>
  )
}
