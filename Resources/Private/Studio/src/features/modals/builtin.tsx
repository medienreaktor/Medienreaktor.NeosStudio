import { useMe } from '@/api/me'
import { ProfileSettings } from '@/features/profile/ProfileSettings'
import { SitesAdministration } from '@/features/sites/SitesAdministration'
import { UserAdministration } from '@/features/users/UserAdministration'
import { WorkspacesAdministration } from '@/features/workspaces/WorkspacesAdministration'
import { translate as t } from '@/lib/i18n'
import { settingsDialogRegistry } from './registry'

/**
 * Studio's built-in settings screens, registered exactly like a third-party
 * plugin would register them: each is a settings section in the settings-dialog
 * registry, a propless component that reads app state via context. Further
 * classic backend modules register here as their settings screens land.
 */

/** Well-known built-in ids, namespaced under the Neos vendor. */
export const PROFILE_SETTINGS = 'neos:profile'
export const USERS_SETTINGS = 'neos:users'
export const SITES_SETTINGS = 'neos:sites'
export const WORKSPACES_SETTINGS = 'neos:workspaces'

/** Call once before the app mounts, alongside registerBuiltinPanels(). */
export function registerBuiltinModals(): void {
  settingsDialogRegistry.register({
    // The own account - available to every logged-in user, so no useEnabled
    // gate. Its "account" group draws a separator between it and the
    // administration sections below.
    id: PROFILE_SETTINGS,
    title: t('modal.profile', 'Profile'),
    icon: 'user',
    component: ProfileSettings,
    order: 0,
    group: 'account',
  })
  settingsDialogRegistry.register({
    id: USERS_SETTINGS,
    title: t('modal.users', 'Users'),
    icon: 'users',
    component: UserAdministration,
    order: 10,
    // User administration is administrators only (the /users endpoint 403s
    // otherwise); non-admins still see the entry, disabled.
    useEnabled: () => useMe().data?.permissions.users ?? false,
    disabledReason: t('modal.adminsOnly', 'Administrators only'),
  })
  settingsDialogRegistry.register({
    id: SITES_SETTINGS,
    title: t('modal.sites', 'Sites'),
    icon: 'globe',
    component: SitesAdministration,
    order: 20,
    useEnabled: () => useMe().data?.permissions.sites ?? false,
    disabledReason: t('modal.adminsOnly', 'Administrators only'),
  })
  settingsDialogRegistry.register({
    id: WORKSPACES_SETTINGS,
    title: t('modal.workspaces', 'Workspaces'),
    icon: 'layer-group',
    component: WorkspacesAdministration,
    order: 30,
    // The classic Workspaces module privilege - editors normally have it.
    useEnabled: () => useMe().data?.permissions.workspaces ?? false,
    disabledReason: t('modal.noPermission', 'Not available for your account'),
  })
}
