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
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { toast } from '@/components/ui/toast'
import { requestPanelReveal } from '@/features/panels/reveal'
import { requestTaskFocus } from '@/features/tasks/focus'
import { translate as t } from '@/lib/i18n'

/**
 * The notification bell in the sidebar header, next to the user menu. Only
 * present while something is unread - no unread notifications, no bell. Shows
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

  // The bell exists only while something is unread; the hook above keeps
  // polling regardless, so it reappears when a new notification arrives.
  if (!data || data.unreadCount === 0) return null

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
        className="relative flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-neutral-950 dark:text-white select-none hover:text-neutral-950 dark:hover:text-white focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-hidden"
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
            <span className="font-medium text-neutral-950 dark:text-white">
              {t('notifications.label', 'Notifications')}
            </span>
            {/* Marking everything read hides the bell (and this menu) - the
                notifications had their moment, there is no archive view. */}
            <button
              type="button"
              className="cursor-pointer text-xs text-neutral-600 dark:text-neutral-400 hover:text-neutral-950 dark:hover:text-white"
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
            >
              {t('notifications.markAllRead', 'Mark all as read')}
            </button>
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
                  onOpen={() => {
                    if (notification.readAt === null) {
                      markRead.mutate([notification.id])
                    }
                    // Task notifications carry their workspace: give the
                    // user the context - reveal the board, open the task.
                    const workspaceName = notification.payload.workspaceName
                    if (typeof workspaceName === 'string') {
                      requestPanelReveal('tasks')
                      requestTaskFocus(workspaceName)
                    }
                  }}
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
  onOpen,
}: {
  notification: StudioNotification
  onOpen: () => void
}) {
  const unread = notification.readAt === null
  const hasTarget = typeof notification.payload.workspaceName === 'string'

  return (
    // A real menu item so clicking closes the menu and keyboard navigation
    // works - the click marks the notification read and jumps to its task.
    <DropdownMenuItem
      className={`items-start gap-2 ${unread ? '' : 'opacity-60'}`}
      onClick={onOpen}
      title={
        hasTarget
          ? t('notifications.openTask', 'Open the task')
          : unread
            ? t('notifications.markRead', 'Mark as read')
            : undefined
      }
    >
      <span
        className={`mt-1.5 size-1.5 shrink-0 rounded-full ${
          unread ? 'bg-blue-500' : 'bg-transparent'
        }`}
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-neutral-950 dark:text-white">
          {notification.title}
        </span>
        {notification.message && (
          <span className="mt-0.5 line-clamp-3 block text-xs text-neutral-600 dark:text-neutral-400">
            {notification.message}
          </span>
        )}
        <span className="mt-0.5 block text-[0.65rem] text-neutral-500">
          {new Date(notification.createdAt).toLocaleString()}
        </span>
      </span>
    </DropdownMenuItem>
  )
}
