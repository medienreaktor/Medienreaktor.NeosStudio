import { neosKeys } from '@/api/neos/keys'
import { queryClient } from '@/app/queryClient'

/**
 * Refresh everything workspace-related: Neos.Api's workspace reads (the list,
 * changes, roles, events - and what the review, pending history and trash are
 * made of) - after a write that may affect any of them.
 */
export function invalidateWorkspaceQueries(): Promise<unknown> {
  return queryClient.invalidateQueries({ queryKey: neosKeys.workspaces.all })
}
