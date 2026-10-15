import { skipToken, useQuery } from '@tanstack/react-query'
import { api, unwrap } from '../../neos/client'
import { studioKeys } from '../keys'
import type { NotificationsMarkRead } from '../schema'

// Deliberately slow: own actions invalidate the cache directly, the poll only
// picks up notifications produced elsewhere - background delivery, not live.
const POLL_INTERVAL_MS = 300_000

/**
 * The newest page of the user's notifications, polled - there is no push
 * channel. meta.unread counts all unread ones. Polling only runs while
 * enabled (i.e. while authenticated).
 */
export function useNotifications(enabled = true) {
  return useQuery({
    queryKey: studioKeys.notifications,
    queryFn: enabled
      ? ({ signal }) =>
          unwrap(
            api.GET('/notifications', {
              params: { query: { limit: 20 } },
              signal,
            }),
          )
      : skipToken,
    refetchInterval: POLL_INTERVAL_MS,
  })
}

export async function markNotificationsRead(ids: string[]): Promise<void> {
  await unwrap(
    api.POST('/notifications/read', {
      body: { ids } satisfies NotificationsMarkRead,
    }),
  )
}

export async function markAllNotificationsRead(): Promise<void> {
  await unwrap(
    api.POST('/notifications/read', {
      body: { all: true } satisfies NotificationsMarkRead,
    }),
  )
}
