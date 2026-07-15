import { UsersIcon } from 'lucide-react'

import { useMe } from '@/api/me'
import { UserAdministration } from '@/features/users/UserAdministration'
import { settingsDialogRegistry } from './registry'

/**
 * Studio's built-in modal screens, registered exactly like a third-party
 * plugin would register them: single-module dialogs go in the modal-dialog
 * registry, settings sections in the settings-dialog registry. Each screen is
 * a propless component that reads app state via context.
 *
 * Media moved out to a dockable panel (see features/panels/builtin.tsx), so no
 * built-in single-module dialogs remain - the modalDialogRegistry stays as an
 * extension point for third-party full-screen modules. Sites, workspaces and
 * the rest register here as their settings screens land.
 */

/** Well-known built-in ids, namespaced under the Neos vendor. */
export const USERS_SETTINGS = 'neos:users'

/** Call once before the app mounts, alongside registerBuiltinPanels(). */
export function registerBuiltinModals(): void {
  settingsDialogRegistry.register({
    id: USERS_SETTINGS,
    title: 'Users',
    icon: UsersIcon,
    component: UserAdministration,
    order: 10,
    // User administration is administrators only (the /users endpoint 403s
    // otherwise); non-admins still see the entry, disabled.
    useEnabled: () => useMe().data?.permissions.users ?? false,
    disabledReason: 'Administrators only',
  })
}
