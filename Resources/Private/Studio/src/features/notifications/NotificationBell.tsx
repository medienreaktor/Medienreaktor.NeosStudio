import { useMutation } from '@tanstack/react-query'
import {
  markAllNotificationsRead,
  markNotificationsRead,
  useNotifications,
  type StudioNotification,
} from '@/api/notifications'
import { queryKeys } from '@/api/keys'
import { queryClient } from '@/app/queryClient'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { toast } from '@/components/ui/toast'
import { translate as t } from '@/lib/i18n'

/**
 * The notification bell in the sidebar header, next to the user menu. Shows
 * the unread count and opens the list of recent notifications; producers are
 * backend packages going through the NotificationService (the payload shape is
 * theirs, the shell renders title/message/time generically).
 */
export function NotificationBell() {
  const { data } = useNotifications()

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.notifications })

  const markRead = useMutation({
    mutationFn: (ids: string[]) => markNotificationsRead(ids),
    onSuccess: () => void invalidate(),
    onError: (error) =>
      toast.error(error, {
        title: t('notifications.markReadFailed', 'Marking as read failed'),
      }),
  })

  const markAllRead = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => void invalidate(),
    onError: (error) =>
      toast.error(error, {
        title: t('notifications.markReadFailed', 'Marking as read failed'),
      }),
  })

  // Render nothing until the first poll resolves - the bell appears with the
  // rest of the header content once the session is established (like UserMenu).
  if (!data) return null

  const { notifications, unreadCount } = data

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t('notifications.label', 'Notifications')}
        title={
          unreadCount > 0
            ? t('notifications.unreadCount', `${unreadCount} unread`, {
                count: unreadCount,
              })
            : t('notifications.label', 'Notifications')
        }
        className="relative flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-neutral-400 select-none hover:text-white focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-hidden"
      >
        <i className="fas fa-bell text-[0.8rem]" aria-hidden />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-red-500 px-0.5 text-[0.55rem] leading-none font-semibold text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center justify-between">
            <span className="font-medium text-white">
              {t('notifications.label', 'Notifications')}
            </span>
            {unreadCount > 0 && (
              <button
                type="button"
                className="cursor-pointer text-xs text-neutral-400 hover:text-white"
                onClick={() => markAllRead.mutate()}
                disabled={markAllRead.isPending}
              >
                {t('notifications.markAllRead', 'Mark all as read')}
              </button>
            )}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {notifications.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-neutral-500">
              {t('notifications.empty', 'No notifications.')}
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              {notifications.map((notification) => (
                <NotificationRow
                  key={notification.id}
                  notification={notification}
                  onMarkRead={() => markRead.mutate([notification.id])}
                />
              ))}
            </div>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function NotificationRow({
  notification,
  onMarkRead,
}: {
  notification: StudioNotification
  onMarkRead: () => void
}) {
  const unread = notification.readAt === null

  return (
    <div
      role="button"
      tabIndex={0}
      className={`flex w-full cursor-pointer gap-2 rounded-sm px-3 py-2 text-left hover:bg-neutral-800 ${
        unread ? '' : 'opacity-60'
      }`}
      onClick={() => unread && onMarkRead()}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && unread) onMarkRead()
      }}
      title={unread ? t('notifications.markRead', 'Mark as read') : undefined}
    >
      <span
        className={`mt-1.5 size-1.5 shrink-0 rounded-full ${
          unread ? 'bg-blue-500' : 'bg-transparent'
        }`}
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-white">
          {notification.title}
        </span>
        {notification.message && (
          <span className="mt-0.5 line-clamp-3 block text-xs text-neutral-400">
            {notification.message}
          </span>
        )}
        <span className="mt-0.5 block text-[0.65rem] text-neutral-500">
          {new Date(notification.createdAt).toLocaleString()}
        </span>
      </span>
    </div>
  )
}
