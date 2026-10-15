import { useQuery } from '@tanstack/react-query'
import { queryClient } from '@/app/queryClient'
import { apiFetch, fetchAllPages } from '../client'
import { neosKeys } from '../keys'
import type { User, UserCreate, UserOptions, UserUpdate } from '../schema'

/**
 * The backend users (Neos.Api's Users tag). Neos.Api lists them to user
 * managers; the Studio's Policy.yaml grants every editor reading them, since
 * the shell names users everywhere editors work together.
 */

function usersQuery() {
  return {
    queryKey: neosKeys.users.all,
    queryFn: () => fetchAllPages<User>('/users'),
  }
}

export function useUsers(enabled = true) {
  return useQuery({ ...usersQuery(), enabled })
}

/** Imperative variant of useUsers, for non-hook contexts. */
export function fetchUsers(): Promise<User[]> {
  return queryClient.fetchQuery({ ...usersQuery(), staleTime: 5 * 60 * 1000 })
}

/** The roles of all of the user's accounts. */
export function userRoles(user: User): string[] {
  return [...new Set(user.accounts.flatMap((account) => account.roles))]
}

/** The roles an administrator can assign in the role picker. */
export function useUserOptions(enabled = true) {
  return useQuery({
    queryKey: neosKeys.users.options,
    queryFn: () => apiFetch<UserOptions>('/options/users'),
    enabled,
  })
}

function userPath(userId: string): string {
  return `/users/${encodeURIComponent(userId)}`
}

export function createUser(input: UserCreate): Promise<User> {
  return apiFetch<User>('/users', { method: 'POST', body: input })
}

/**
 * Partial update - absent keys are left as they are. An email address can be
 * changed but not removed; roles replace the roles of all of the user's
 * accounts.
 */
export function updateUser(userId: string, input: UserUpdate): Promise<User> {
  return apiFetch<User>(userPath(userId), { method: 'PATCH', body: input })
}

/** Administrative password reset - no current password required. */
export async function setUserPassword(
  userId: string,
  newPassword: string,
): Promise<void> {
  await apiFetch(`${userPath(userId)}/password`, {
    method: 'PUT',
    body: { newPassword },
  })
}

export async function deleteUser(userId: string): Promise<void> {
  await apiFetch(userPath(userId), { method: 'DELETE' })
}
