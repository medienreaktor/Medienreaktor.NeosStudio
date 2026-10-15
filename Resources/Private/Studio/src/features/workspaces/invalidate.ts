import { neosKeys } from '@/api/neos/keys'
import { studioKeys } from '@/api/studio/keys'
import { queryClient } from '@/app/queryClient'

/**
 * Refresh everything workspace-related: Neos.Api's workspace reads (the list,
 * changes, roles) and the Studio's read models of workspaces (review, pending
 * history, trash) - after a write that may affect any of them.
 */
export function invalidateWorkspaceQueries(): Promise<unknown> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: neosKeys.workspaces.all }),
    queryClient.invalidateQueries({ queryKey: studioKeys.workspaces.all }),
  ])
}
