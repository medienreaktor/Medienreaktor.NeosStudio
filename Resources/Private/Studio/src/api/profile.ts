import { useQuery } from '@tanstack/react-query'
import { apiFetch } from './client'
import { queryKeys } from './keys'

/**
 * The authenticated user's own profile - the self-service counterpart to the
 * admin-only /users listing. Every editor may read and edit it.
 */
export interface Profile {
  firstName: string
  lastName: string
  fullName: string
  email: string | null
  /** The user's interface language preference (e.g. "en", "de"). */
  interfaceLanguage: string
  /** Locale identifier => label, the options for the language picker. */
  availableLanguages: Record<string, string>
  /**
   * Free-form per-user preferences. The server stores keys verbatim and has
   * no schema - clients bring their own namespaced keys (Studio uses
   * "studio.uiMode" etc.) and must validate what they read back.
   */
  preferences: Record<string, unknown>
}

export interface ProfileResponse {
  profile: Profile
}

export interface UpdateProfileInput {
  firstName?: string
  lastName?: string
  email?: string
  interfaceLanguage?: string
  /** Partial merge: only the given keys are written, null deletes a key. */
  preferences?: Record<string, unknown>
}

export function useProfile(enabled = true) {
  return useQuery({
    queryKey: queryKeys.profile,
    queryFn: () => apiFetch<ProfileResponse>('/me/profile'),
    enabled,
  })
}

/** Partial update - absent keys are left as-is on the server. */
export function updateProfile(input: UpdateProfileInput) {
  return apiFetch<ProfileResponse>('/me/profile', {
    method: 'PATCH',
    body: input,
  })
}

export function changePassword(currentPassword: string, newPassword: string) {
  return apiFetch<{ success: boolean }>('/me/password', {
    method: 'PUT',
    body: { currentPassword, newPassword },
  })
}
