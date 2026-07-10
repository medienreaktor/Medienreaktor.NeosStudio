import type { Workspace } from '@/api/workspaces'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

/**
 * Topbar dropdown selecting the active workspace. Only personal and shared
 * workspaces are offered - editors never browse live (ROOT) directly; live
 * content is what a workspace's unchanged nodes show anyway.
 */
export function WorkspaceSwitcher({
  workspaces,
  value,
  onChange,
}: {
  workspaces: Workspace[]
  /** name of the active workspace */
  value: string | null
  onChange: (name: string) => void
}) {
  return (
    <Select value={value ?? undefined} onValueChange={onChange}>
      <SelectTrigger className="w-48" title="Active workspace" size="sm">
        <SelectValue placeholder="Select workspace…" />
      </SelectTrigger>
      <SelectContent>
        {workspaces.map((workspace) => (
          <SelectItem key={workspace.name} value={workspace.name}>
            <i
              className={`fas ${workspace.classification === 'PERSONAL' ? 'fa-user' : 'fa-users'} fa-fw text-[0.7rem] text-muted-foreground`}
              aria-hidden
            />
            {/* The personal workspace is titled after the user; a static
                label reads better than seeing your own name. */}
            {workspace.classification === 'PERSONAL' ? 'Personal Workspace' : workspace.title || workspace.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
