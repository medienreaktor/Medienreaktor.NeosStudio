import { hasPrivilege, useMe } from '@/api/neos/endpoints/me'
import { useMyAccess } from '@/api/studio/endpoints/accessRoles'

/**
 * What the shell gates its administration sections by: the account's
 * Neos.Api privileges, and for the access roles the Studio's own answer.
 * Only shapes the UI - the endpoints refuse what the account may not do.
 */
export function useAdministrationPermissions() {
  const { data: me } = useMe()
  const { data: access } = useMyAccess()
  const users =
    hasPrivilege(me, 'users.read') || hasPrivilege(me, 'users.update')
  const sites = hasPrivilege(me, 'sites.update')
  return {
    media: hasPrivilege(me, 'assets.read'),
    users,
    sites,
    // The classic Workspaces module is open to every editor - the closest
    // privilege is the one to create workspaces (granted to all editors).
    workspaces: hasPrivilege(me, 'workspaces.create'),
    accessRoles: access?.canAdminister === true,
    administration: users || sites,
  }
}
