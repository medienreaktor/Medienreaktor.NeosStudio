import { useCallback } from 'react'

import { useMe } from '@/api/neos/endpoints/me'
import type { User } from '@/api/neos/schema'

/** "First Last" of a user, empty when neither is set. */
export function fullName(user: Pick<User, 'firstName' | 'lastName'>): string {
  return [user.firstName, user.lastName].filter(Boolean).join(' ')
}

/** Whether a user is the signed-in one - for the self-lockout guards. */
export function useIsCurrentUser(): (user: User | null) => boolean {
  const { data: me } = useMe()
  const currentId = me?.user?.id ?? null
  return useCallback(
    (user: User | null) => user !== null && user.id === currentId,
    [currentId],
  )
}
