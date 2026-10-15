import { skipToken, useQuery } from '@tanstack/react-query'
import { api, fetchAllPages, unwrap } from '../client'
import { neosKeys } from '../keys'
import type { User, UserCreate, UserPasswordSet, UserUpdate } from '../schema'

/**
 * The backend users (Neos.Api's Users tag). Neos.Api lists them to user
 * managers; the Studio's Policy.yaml grants every editor reading them, since
 * the shell names users everywhere editors work together.
 */

export function useUsers(enabled = true) {
  return useQuery({
    queryKey: neosKeys.users.all,
    queryFn: enabled
      ? ({ signal }): Promise<User[]> =>
          fetchAllPages((page) =>
            unwrap(api.GET('/users', { params: { query: page }, signal })),
          )
      : skipToken,
  })
}

/** The roles of all of the user's accounts. */
export function userRoles(user: User): string[] {
  return [...new Set(user.accounts.flatMap((account) => account.roles))]
}

/** The roles an administrator can assign in the role picker. */
export function useUserOptions(enabled = true) {
  return useQuery({
    queryKey: neosKeys.users.options,
    queryFn: enabled
      ? ({ signal }) => unwrap(api.GET('/options/users', { signal }))
      : skipToken,
  })
}

export function createUser(input: UserCreate): Promise<User> {
  return unwrap(api.POST('/users', { body: input }))
}

/**
 * Partial update - absent keys are left as they are. An email address can be
 * changed but not removed; roles replace the roles of all of the user's
 * accounts.
 */
export function updateUser(userId: string, input: UserUpdate): Promise<User> {
  return unwrap(
    api.PATCH('/users/{userId}', {
      params: { path: { userId } },
      body: input,
    }),
  )
}

/** Administrative password reset - no current password required. */
export async function setUserPassword(
  userId: string,
  newPassword: string,
): Promise<void> {
  await unwrap(
    api.PUT('/users/{userId}/password', {
      params: { path: { userId } },
      body: { newPassword } satisfies UserPasswordSet,
    }),
  )
}

export async function deleteUser(userId: string): Promise<void> {
  await unwrap(api.DELETE('/users/{userId}', { params: { path: { userId } } }))
}
