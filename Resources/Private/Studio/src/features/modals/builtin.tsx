import { useMe } from '@/api/me'
import { ProfileSettings } from '@/features/profile/ProfileSettings'
import { UserAdministration } from '@/features/users/UserAdministration'
import { settingsDialogRegistry } from './registry'

/**
 * Studio's built-in settings screens, registered exactly like a third-party
 * plugin would register them: each is a settings section in the settings-dialog
 * registry, a propless component that reads app state via context. Sites,
 * workspaces and the rest register here as their settings screens land.
 */

/** Well-known built-in ids, namespaced under the Neos vendor. */
export const PROFILE_SETTINGS = 'neos:profile'
export const USERS_SETTINGS = 'neos:users'

/** Call once before the app mounts, alongside registerBuiltinPanels(). */
export function registerBuiltinModals(): void {
  settingsDialogRegistry.register({
    // The own account - available to every logged-in user, so no useEnabled
    // gate. Its "account" group draws a separator between it and the
    // administration sections below.
    id: PROFILE_SETTINGS,
    title: 'Profile',
    icon: 'user',
    component: ProfileSettings,
    order: 0,
    group: 'account',
  })
  settingsDialogRegistry.register({
    id: USERS_SETTINGS,
    title: 'Users',
    icon: 'users',
    component: UserAdministration,
    order: 10,
    // User administration is administrators only (the /users endpoint 403s
    // otherwise); non-admins still see the entry, disabled.
    useEnabled: () => useMe().data?.permissions.users ?? false,
    disabledReason: 'Administrators only',
  })
}
