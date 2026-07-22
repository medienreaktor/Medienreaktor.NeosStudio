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
 * The backend users. The listing itself is readable by every editor (it
 * doubles as the collaboration name roster), but the Studio only surfaces
 * user administration behind me.permissions.users - all the write calls
 * below are admin-gated server-side (Api.Users.Write) and 403 otherwise.
 */
export function useUsers(enabled = true) {
  return useQuery({
    queryKey: queryKeys.users,
    queryFn: () => apiFetch<UsersResponse>('/users'),
    enabled,
  })
}

/** One assignable role from the policy framework (non-abstract). */
export interface RoleInfo {
  identifier: string
  label: string
  packageKey: string
}

export interface RolesResponse {
  roles: RoleInfo[]
}

/**
 * The roles an administrator can assign in the role picker. Admin-gated
 * server-side (part of Api.Users.Write); callers gate on
 * me.permissions.users.
 */
export function useUserRoles(enabled = true) {
  return useQuery({
    queryKey: queryKeys.userRoles,
    queryFn: () => apiFetch<RolesResponse>('/users/roles'),
    enabled,
  })
}

export interface CreateUserInput {
  username: string
  password: string
  firstName: string
  lastName: string
  /** Role identifiers; the server defaults to Neos.Neos:Editor when omitted. */
  roles?: string[]
  email?: string
}

/**
 * Partial update - absent keys are left as-is on the server. An empty email
 * string removes the address; "password" is an administrative reset (no
 * current password required); "roles" replaces the assigned roles on all of
 * the user's accounts.
 */
export interface UpdateUserInput {
  firstName?: string
  lastName?: string
  email?: string
  roles?: string[]
  active?: boolean
  password?: string
}

export function createUser(input: CreateUserInput) {
  return apiFetch<{ user: User }>('/users', { method: 'POST', body: input })
}

export function updateUser(userId: string, input: UpdateUserInput) {
  return apiFetch<{ user: User }>(`/users/${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    body: input,
  })
}

export function deleteUser(userId: string) {
  return apiFetch<{ success: boolean }>(
    `/users/${encodeURIComponent(userId)}`,
    { method: 'DELETE' },
  )
}
