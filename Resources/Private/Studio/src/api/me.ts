import { useQuery } from '@tanstack/react-query'
import { apiFetch } from './client'
import { queryKeys } from './keys'

export interface Me {
  account: string | null
  roles: string[]
  scopes: string[]
  client: string | null
  contentRepository: string
}

export function useMe(enabled = true) {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: () => apiFetch<Me>('/me'),
    enabled,
  })
}
