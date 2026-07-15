import { ImageIcon, UsersIcon } from 'lucide-react'

import { MediaModule } from '@/features/media/MediaModule'
import { UserAdministration } from '@/features/users/UserAdministration'
import { modalDialogRegistry, settingsDialogRegistry } from './registry'

/**
 * Studio's built-in modal screens, registered exactly like a third-party
 * plugin would register them: single-module dialogs go in the modal-dialog
 * registry, settings sections in the settings-dialog registry. Each screen is
 * a propless component that reads app state via context.
 *
 * Kept deliberately small for now - one of each - so the two registries have
 * real, reachable content. Sites, workspaces and the rest register here as
 * their screens land.
 */

/** Well-known built-in ids, namespaced under the Neos vendor. */
export const MEDIA_MODAL = 'neos:media'
export const USERS_SETTINGS = 'neos:users'

/** Call once before the app mounts, alongside registerBuiltinPanels(). */
export function registerBuiltinModals(): void {
  modalDialogRegistry.register({
    id: MEDIA_MODAL,
    title: 'Media',
    icon: ImageIcon,
    component: MediaModule,
    order: 10,
  })
  settingsDialogRegistry.register({
    id: USERS_SETTINGS,
    title: 'Users',
    icon: UsersIcon,
    component: UserAdministration,
    order: 10,
  })
}
