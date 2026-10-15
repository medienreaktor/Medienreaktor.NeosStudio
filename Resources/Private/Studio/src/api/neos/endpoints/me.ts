import { skipToken, useQuery } from '@tanstack/react-query'
import { api, unwrap } from '../client'
import { neosKeys } from '../keys'
import type {
  CurrentAccount,
  PasswordChange,
  Profile,
  ProfileUpdate,
} from '../schema'

/**
 * The current account (Neos.Api's Me tag): its user, roles, the token's
 * scopes and the Neos.Api privileges the account is granted.
 */
export function useMe(enabled = true) {
  return useQuery({
    queryKey: neosKeys.me,
    queryFn: enabled
      ? ({ signal }) => unwrap(api.GET('/me', { signal }))
      : skipToken,
  })
}

/** Whether the account is granted the Neos.Api privilege (a scope name, e.g. users.read). */
export function hasPrivilege(
  account: CurrentAccount | undefined,
  privilege: string,
): boolean {
  return account?.privileges.includes(privilege) === true
}

/**
 * The own profile - the self-service counterpart to the user administration;
 * every editor may read and edit it. Its preferences are free-form: the
 * Studio keeps namespaced keys there ("studio.uiMode", ...) and validates
 * what it reads back.
 */
export function useProfile(enabled = true) {
  return useQuery({
    queryKey: neosKeys.profile,
    queryFn: enabled
      ? ({ signal }) => unwrap(api.GET('/me/profile', { signal }))
      : skipToken,
  })
}

/** Partial update; preferences merge, a null preference is deleted. */
export function updateProfile(input: ProfileUpdate): Promise<Profile> {
  return unwrap(api.PATCH('/me/profile', { body: input }))
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await unwrap(
    api.PUT('/me/password', {
      body: { currentPassword, newPassword } satisfies PasswordChange,
    }),
  )
}
