import { useWorkspaces, type Workspace } from '@/api/workspaces'
import { Badge } from '@/components/ui/badge'
import { translate as t } from '@/lib/i18n'

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
    icon:
      base?.classification === 'ROOT'
        ? 'fa-earth-americas'
        : base?.classification === 'SHARED'
          ? 'fa-users'
          : 'fa-code-branch',
    classification: base?.classification ?? null,
  }
}

/**
 * Pill colors by the target's classification: green for live (ROOT), orange
 * for a shared workspace, white with dark text otherwise. Fixed in both color
 * schemes - the pill sits on a neutral trigger either way.
 */
const TARGET_STYLES: Record<string, { pill: string; icon: string }> = {
  ROOT: {
    pill: 'bg-green-500 text-white dark:bg-green-500 dark:text-white',
    icon: 'text-white',
  },
  SHARED: {
    pill: 'bg-orange-500 text-white dark:bg-orange-500 dark:text-white',
    icon: 'text-white',
  },
}
const DEFAULT_TARGET_STYLE = {
  pill: 'bg-white text-neutral-950 dark:bg-white dark:text-neutral-950',
  icon: 'text-neutral-600',
}

/**
 * "→ target" pill naming the publish target of a workspace. The label
 * collapses with the topbar (icon only).
 */
export function PublishTargetBadge({ workspace }: { workspace: Workspace }) {
  const { label, icon, classification } = usePublishTarget(workspace)
  const style =
    (classification && TARGET_STYLES[classification]) || DEFAULT_TARGET_STYLE
  return (
    <Badge variant="secondary" className={`gap-1.5 font-normal ${style.pill}`}>
      <i
        className={`fas fa-arrow-right text-[0.6rem] ${style.icon}`}
        aria-hidden
      />
      <i
        className={`fas fa-fw ${icon} text-[0.65rem] ${style.icon}`}
        aria-hidden
      />
      <span className="hidden @[56rem]:inline max-w-40 truncate">{label}</span>
    </Badge>
  )
}
