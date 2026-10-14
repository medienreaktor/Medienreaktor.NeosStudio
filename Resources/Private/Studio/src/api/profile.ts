import { useQuery } from '@tanstack/react-query'
import { apiFetch } from './client'
import { queryKeys } from './keys'

/**
 * The authenticated user's own profile (Neos.Api GET /me/profile) - the
 * self-service counterpart to the admin-only user administration. Every
 * editor may read and edit it. The language options are not part of it: they
 * come with the shell's boot config (config.availableLanguages).
 */
export interface Profile {
  firstName: string
  lastName: string
  email: string | null
  /** The user's interface language preference (e.g. "en", "de"). */
  interfaceLanguage: string
  /**
   * Free-form per-user preferences. The server stores keys verbatim and has
   * no schema - clients bring their own namespaced keys (Studio uses
   * "studio.uiMode" etc.) and must validate what they read back.
   */
  preferences: Record<string, unknown>
}

export interface UpdateProfileInput {
  firstName?: string
  lastName?: string
  /** An email address can be changed but not removed. */
  email?: string
  interfaceLanguage?: string
  /** Partial merge: only the given keys are written, null deletes a key. */
  preferences?: Record<string, unknown>
}

export function useProfile(enabled = true) {
  return useQuery({
    queryKey: queryKeys.profile,
    queryFn: () => apiFetch<Profile>('/me/profile'),
    enabled,
  })
}

/** Partial update - absent keys are left as-is on the server. */
export function updateProfile(input: UpdateProfileInput): Promise<Profile> {
  return apiFetch<Profile>('/me/profile', {
    method: 'PATCH',
    body: input,
  })
}

/** Resolves once the password is changed (204). */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await apiFetch<null>('/me/password', {
    method: 'PUT',
    body: { currentPassword, newPassword },
  })
}
