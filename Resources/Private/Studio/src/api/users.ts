import { useQuery } from '@tanstack/react-query'
import { apiFetch } from './client'
import { queryKeys } from './keys'

/** One authentication account of a user (usually the Neos.Neos:Backend one). */
export interface UserAccount {
  accountIdentifier: string
  authenticationProvider: string
  active: boolean
}

export interface User {
  /** Stable user id (Neos UserId). */
  id: string
  /** Human-readable label the backend computes (full name, falling back to the account). */
  label: string
  firstName: string | null
  lastName: string | null
  /** Full name, possibly empty if the user has no person name set. */
  fullName: string
  /** Primary electronic address, or null if none is set. */
  email: string | null
  active: boolean
  /** Assigned role identifiers, framework-internal roles omitted. */
  roles: string[]
  accounts: UserAccount[]
  /** True for the account making the request - the UI marks "you". */
  isCurrentUser: boolean
}

export interface UsersResponse {
  users: User[]
}

/**
 * The backend users. Administrators only: the endpoint is admin-gated
 * server-side (see the NeosApi Policy - UsersController is matched only by the
 * Administrator catch-all), so a non-admin request 403s. Callers gate on
 * me.permissions.users before enabling this to avoid the pointless request.
 */
export function useUsers(enabled = true) {
  return useQuery({
    queryKey: queryKeys.users,
    queryFn: () => apiFetch<UsersResponse>('/users'),
    enabled,
  })
}
