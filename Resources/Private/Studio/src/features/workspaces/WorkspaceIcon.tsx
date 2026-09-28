import type { Workspace } from '@/api/workspaces'
import {
  decorationsFor,
  useWorkspaceDecorators,
} from '@/features/workspaces/decorators'

/** FontAwesome icon per workspace classification (without the `fas` prefix). */
const CLASSIFICATION_ICONS: Record<string, string> = {
  ROOT: 'fa-earth-americas',
  SHARED: 'fa-users',
  PERSONAL: 'fa-user',
  PRIVATE: 'fa-lock',
}

/** Colors matching the publish-target badge: blue live, purple shared. */
const CLASSIFICATION_COLORS: Record<string, string> = {
  ROOT: 'text-blue-500',
  SHARED: 'text-purple-500',
}

/** The classification's icon; a branch for anything unknown or unresolved. */
export function workspaceIconName(workspace: Workspace | undefined): string {
  return (
    (workspace && CLASSIFICATION_ICONS[workspace.classification]) ??
    'fa-code-branch'
  )
}

/**
 * Inline icon for a workspace in listings and pickers. A decorated workspace
 * (e.g. a task branch) shows its decoration's icon and color instead of the
 * classification's.
 */
export function WorkspaceIcon({
  workspace,
  className = 'text-[0.7rem]',
}: {
  workspace: Workspace | undefined
  className?: string
}) {
  const decorators = useWorkspaceDecorators()
  const decoration = workspace
    ? decorationsFor(workspace, decorators).find((d) => d.icon)
    : undefined
  const color = decoration?.color
    ? undefined
    : ((workspace && CLASSIFICATION_COLORS[workspace.classification]) ??
      'text-neutral-600 dark:text-neutral-400')
  return (
    <i
      className={`fas fa-fw ${
        decoration?.icon
          ? `fa-${decoration.icon}`
          : workspaceIconName(workspace)
      } ${color ?? ''} ${className}`}
      style={decoration?.color ? { color: decoration.color } : undefined}
      aria-hidden
    />
  )
}
