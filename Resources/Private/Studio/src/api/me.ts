import { useQuery } from '@tanstack/react-query'
import { apiFetch } from './client'
import { queryKeys } from './keys'

export interface Me {
  account: string | null
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
