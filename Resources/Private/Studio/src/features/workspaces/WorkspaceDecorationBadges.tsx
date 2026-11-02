import type { Workspace } from '@/api/neos/schema'
import {
  decorationsFor,
  useWorkspaceDecorators,
} from '@/features/workspaces/decorators'

/**
 * Inline badge row for a workspace's decorations (see decorators.ts). Renders
 * nothing when no registered decorator marks the workspace, so it can be
 * dropped unconditionally into any workspace listing.
 */
export function WorkspaceDecorationBadges({
  workspace,
}: {
  workspace: Workspace
}) {
  const decorators = useWorkspaceDecorators()
  const decorations = decorationsFor(workspace, decorators)
  if (decorations.length === 0) return null

  return (
    <>
      {decorations.map((decoration, index) => (
        <span
          key={index}
          title={decoration.label}
          className="inline-flex items-center rounded-sm border border-current px-1 py-px align-middle type-overline select-none"
          style={{
            color: decoration.color ?? 'var(--color-muted-foreground)',
          }}
        >
          {decoration.badge}
        </span>
      ))}
    </>
  )
}
