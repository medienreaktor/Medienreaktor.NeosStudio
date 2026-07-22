import { useQuery } from '@tanstack/react-query'
import { apiFetch } from './client'
import { queryKeys } from './keys'

export interface Me {
  account: string | null
  /**
   * The Neos user behind the account - the id matches the content
   * repository's initiatingUserId event metadata and the presence roster, so
   * the client can tell its own changes from colleagues'. null for
   * non-user-bound authentications (client credentials).
   */
  user: { id: string; label: string } | null
  roles: string[]
  scopes: string[]
  client: string | null
  contentRepository: string
  /**
   * Capability flags evaluated from Flow privilege targets - the same checks
   * the classic backend menu uses to show/hide modules. The names mirror the
   * server's accountPermissions setting, which distributions can extend.
   */
  permissions: {
    media: boolean
    users: boolean
    sites: boolean
    workspaces: boolean
    administration: boolean
  } & Record<string, boolean>
}

export function useMe(enabled = true) {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: () => apiFetch<Me>('/me'),
    enabled,
  })
}
