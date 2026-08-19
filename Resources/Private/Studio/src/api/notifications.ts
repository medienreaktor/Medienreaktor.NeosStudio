import { useQuery } from '@tanstack/react-query'
import { apiFetch } from './client'
import { queryKeys } from './keys'

/**
 * A notification addressed to the current user, produced server-side by any
 * package through Medienreaktor.NeosStudio's NotificationService. `type` is a
 * producer-namespaced discriminator (e.g. "taskWorkflow.assigned"), `payload`
 * carries structured data whose shape only the producer knows.
 */
export interface StudioNotification {
  id: string
  source: string
  type: string
  title: string
  message: string
  payload: Record<string, unknown>
  createdAt: string
  readAt: string | null
}

export interface NotificationsResponse {
  notifications: StudioNotification[]
  unreadCount: number
}

// Deliberately slow: own actions invalidate the cache directly, the poll only
// picks up notifications produced elsewhere - background delivery, not live.
const POLL_INTERVAL_MS = 300_000

/**
 * The user's notifications, polled - there is no push channel, matching the
 * presence/event-feed approach. Polling only runs while enabled (i.e. while
 * authenticated).
 */
export function useNotifications(enabled = true) {
  return useQuery({
    queryKey: queryKeys.notifications,
    queryFn: () => apiFetch<NotificationsResponse>('/notifications'),
    enabled,
    refetchInterval: POLL_INTERVAL_MS,
  })
}

export function markNotificationsRead(ids: string[]) {
  return apiFetch<{ unreadCount: number }>('/notifications/read', {
    method: 'POST',
    body: { ids },
  })
}

export function markAllNotificationsRead() {
  return apiFetch<{ unreadCount: number }>('/notifications/read', {
    method: 'POST',
    body: { all: true },
  })
}

/**
 * Clear the read notifications. Unread ones survive server-side - one may
 * have arrived after the list was last rendered.
 */
export function clearReadNotifications() {
  return apiFetch<{ removed: number; unreadCount: number }>('/notifications', {
    method: 'DELETE',
  })
}
