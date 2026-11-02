import { useMutation } from '@tanstack/react-query'
import {
  markAllNotificationsRead,
  markNotificationsRead,
  useNotifications,
} from '@/api/studio/endpoints/notifications'
import { studioKeys } from '@/api/studio/keys'
import type { StudioNotification } from '@/api/studio/schema'
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
    queryClient.invalidateQueries({ queryKey: studioKeys.notifications })

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
  if (!data || data.meta.unread === 0) return null

  const notifications = data.data
  const unreadCount = data.meta.unread

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t('notifications.label', 'Notifications')}
        title={t('notifications.unreadCount', `${unreadCount} unread`, {
          count: unreadCount,
        })}
        className="relative flex size-6.5 shrink-0 cursor-pointer items-center justify-center rounded-full text-foreground select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
      >
        <i className="fas fa-bell type-icon-l" aria-hidden />
        <span className="absolute -top-0.5 -right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-destructive px-0.5 type-count-small text-destructive-foreground">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-75">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center justify-between">
            <span className="font-medium text-foreground">
              {t('notifications.label', 'Notifications')}
            </span>
            {/* Marking everything read hides the bell (and this menu) - the
                notifications had their moment, there is no archive view. */}
            <button
              type="button"
              className="cursor-pointer type-small text-muted-foreground hover:text-foreground"
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
            >
              {t('notifications.markAllRead', 'Mark all as read')}
            </button>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {notifications.length === 0 ? (
            <div className="px-3 py-5.5 text-center type-body text-muted-foreground">
              {t('notifications.empty', 'No notifications.')}
            </div>
          ) : (
            <div className="max-h-90 overflow-y-auto">
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
          unread ? 'bg-primary' : 'bg-transparent'
        }`}
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate type-body-strong text-foreground">
          {notification.title}
        </span>
        {notification.message && (
          <span className="mt-0.5 line-clamp-3 block type-small text-muted-foreground">
            {notification.message}
          </span>
        )}
        <span className="mt-0.5 block type-caption text-muted-foreground">
          {new Date(notification.createdAt).toLocaleString()}
        </span>
      </span>
    </DropdownMenuItem>
  )
}
