import { useMe } from '@/api/me'
import { logoutEverywhere } from '@/auth/oauth'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  presenceColor,
  presenceInitials,
} from '@/features/collaboration/presenceColors'
import { PROFILE_SETTINGS } from '@/features/modals/builtin'
import { useModals } from '@/features/modals/ModalHost'
import { translate as t } from '@/lib/i18n'

/**
 * The logged-in user in the sidebar header: an initials avatar (no avatar
 * images exist yet - the same color/initials scheme the presence indicators
 * use, so the own identity matches how colleagues see it) opening a menu with
 * the personal entries - the Profile settings section and the logout.
 */
export function UserMenu() {
  const { data: me } = useMe()
  const { openSettings } = useModals()

  // Nothing sensible to show before /me resolves; the avatar simply appears
  // with the rest of the header content once the session is established.
  if (!me) return null

  const name = me.user?.label ?? me.account ?? '?'
  // Client-credential sessions have no user; color by account then.
  const colorKey = me.user?.id ?? me.account ?? 'anonymous'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t('userMenu.label', 'User menu')}
        title={name}
        className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-[0.65rem] font-semibold text-white select-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-hidden"
        style={{ backgroundColor: presenceColor(colorKey) }}
      >
        {presenceInitials(name)}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        {/* GroupLabel must live inside a Group (Base UI error 31 otherwise). */}
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <span className="block truncate font-medium text-white">
              {name}
            </span>
            {me.account && me.account !== name && (
              <span className="block truncate">{me.account}</span>
            )}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => openSettings(PROFILE_SETTINGS)}>
            <i className="fas fa-user w-4 text-center" aria-hidden />
            {t('userMenu.profile', 'Profile')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void logoutEverywhere()}>
            <i
              className="fas fa-arrow-right-from-bracket w-4 text-center"
              aria-hidden
            />
            {t('userMenu.logout', 'Logout')}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
