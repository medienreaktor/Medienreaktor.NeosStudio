import { useQuery } from '@tanstack/react-query'
import { studioFetch } from '../client'
import { studioKeys } from '../keys'
import type { NotificationsResponse } from '../schema'

// Deliberately slow: own actions invalidate the cache directly, the poll only
// picks up notifications produced elsewhere - background delivery, not live.
const POLL_INTERVAL_MS = 300_000

/**
 * The user's notifications, polled - there is no push channel. Polling only
 * runs while enabled (i.e. while authenticated).
 */
export function useNotifications(enabled = true) {
  return useQuery({
    queryKey: studioKeys.notifications,
    queryFn: () => studioFetch<NotificationsResponse>('/notifications'),
    enabled,
    refetchInterval: POLL_INTERVAL_MS,
  })
}

export function markNotificationsRead(ids: string[]) {
  return studioFetch<{ unreadCount: number }>('/notifications/read', {
    method: 'POST',
    body: { ids },
  })
}

export function markAllNotificationsRead() {
  return studioFetch<{ unreadCount: number }>('/notifications/read', {
    method: 'POST',
    body: { all: true },
  })
}

/**
 * Clear the read notifications. Unread ones survive server-side - one may
 * have arrived after the list was last rendered.
 */
export function clearReadNotifications() {
  return studioFetch<{ removed: number; unreadCount: number }>(
    '/notifications',
    {
      method: 'DELETE',
    },
  )
}
