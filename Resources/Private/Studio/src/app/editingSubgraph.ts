import { editingSiteNode } from '@/api/neos/endpoints/sites'
import type { NodeAddress, Site } from '@/api/neos/schema'

let current: NodeAddress | null = null

/**
 * The site node in the active workspace and the selected document's
 * dimension space point - the subgraph lookups use where no node is edited
 * (the creation dialog, a plugin's own UI). Null while sites or workspaces
 * load. Kept outside React for code that formats values imperatively.
 */
export function editingSubgraph(): NodeAddress | null {
  return current
}

export function publishEditingSubgraph(
  site: Site | null,
  workspaceName: string | null,
  dimensionSpacePoint: string | undefined,
): void {
  current = editingSiteNode(site, workspaceName, dimensionSpacePoint)
}
