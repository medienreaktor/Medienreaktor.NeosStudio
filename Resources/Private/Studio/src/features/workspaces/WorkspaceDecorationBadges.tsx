import type { Workspace } from '@/api/workspaces'
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
          className="inline-flex items-center rounded-sm border border-current px-1 py-px align-middle text-[0.6rem] leading-none font-semibold tracking-wide uppercase select-none"
          style={{
            color:
              decoration.color ??
              'light-dark(var(--color-neutral-600), var(--color-neutral-400))',
          }}
        >
          {decoration.badge}
        </span>
      ))}
    </>
  )
}
