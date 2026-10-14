import { useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch, fetchAllPages } from './client'
import { queryKeys } from './keys'
import { useMe } from './me'

/** Neos.Api's User. */
interface ApiUser {
  id: string
  label: string
  firstName: string
  lastName: string
  email: string | null
  active: boolean
  accounts: UserAccount[]
}

/** One authentication account of a user (usually the Neos.Neos:Backend one). */
export interface UserAccount {
  /** The account identifier - the username. */
  identifier: string
  roles: string[]
}

export interface User {
  /** Stable user id (Neos UserId). */
  id: string
  /** Human-readable label the backend computes (full name, falling back to the account). */
  label: string
  firstName: string
  lastName: string
  /** Full name, possibly empty if the user has no person name set. */
  fullName: string
  /** Primary electronic address, or null if none is set. */
  email: string | null
  active: boolean
  /** The roles of all of the user's accounts. */
  roles: string[]
  accounts: UserAccount[]
  /** True for the account making the request - the UI marks "you". */
  isCurrentUser: boolean
}

export interface UsersResponse {
  users: User[]
}

function toUser(user: ApiUser, currentUserId: string | null): User {
  return {
    id: user.id,
    label: user.label,
    firstName: user.firstName,
    lastName: user.lastName,
    fullName: [user.firstName, user.lastName]
      .filter((part) => part !== '')
      .join(' '),
    email: user.email,
    active: user.active,
    roles: [...new Set(user.accounts.flatMap((account) => account.roles))],
    accounts: user.accounts,
    isCurrentUser: currentUserId !== null && user.id === currentUserId,
  }
}

/**
 * The backend users, for user administration only: Neos.Api lists them to
 * user managers and administrators (users.read), everybody else gets a 403.
 * Anything that only needs names (assignee pickers, member labels) reads the
 * people directory instead.
 */
export function useUsers(enabled = true) {
  const { data: me } = useMe()
  const currentUserId = me?.user?.id ?? null
  return useQuery({
    queryKey: queryKeys.users,
    queryFn: () => fetchAllPages<ApiUser>('/users'),
    select: useCallback(
      (users: ApiUser[]): UsersResponse => ({
        users: users.map((user) => toUser(user, currentUserId)),
      }),
      [currentUserId],
    ),
    enabled,
  })
}

/** One assignable role from the policy framework (non-abstract). */
export interface RoleInfo {
  identifier: string
  label: string
  description: string | null
  packageKey: string
}

export interface RolesResponse {
  roles: RoleInfo[]
}

/** The roles an administrator can assign in the role picker. */
export function useUserRoles(enabled = true) {
  return useQuery({
    queryKey: queryKeys.userRoles,
    queryFn: () => apiFetch<RolesResponse>('/options/users'),
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
 * Partial update - absent keys are left as-is on the server. An email
 * address can be changed but not removed; "roles" replaces the assigned
 * roles on all of the user's accounts. Passwords are reset with
 * setUserPassword.
 */
export interface UpdateUserInput {
  firstName?: string
  lastName?: string
  email?: string
  roles?: string[]
  active?: boolean
}

export async function createUser(input: CreateUserInput): Promise<User> {
  const user = await apiFetch<ApiUser>('/users', {
    method: 'POST',
    body: input,
  })
  return toUser(user, null)
}

export async function updateUser(
  userId: string,
  input: UpdateUserInput,
): Promise<User> {
  const user = await apiFetch<ApiUser>(`/users/${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    body: input,
  })
  return toUser(user, null)
}

/** Administrative password reset - no current password required (204). */
export async function setUserPassword(
  userId: string,
  newPassword: string,
): Promise<void> {
  await apiFetch<null>(`/users/${encodeURIComponent(userId)}/password`, {
    method: 'PUT',
    body: { newPassword },
  })
}

export async function deleteUser(userId: string): Promise<void> {
  await apiFetch<null>(`/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  })
}
