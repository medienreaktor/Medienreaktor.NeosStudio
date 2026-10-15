import { skipToken, useQuery } from '@tanstack/react-query'
import { api, unwrap } from '../../neos/client'
import { studioKeys } from '../keys'
import type { AccessRole, AccessRoleCreate, AccessRoleUpdate } from '../schema'

/**
 * Dynamic access roles: named restriction sets an administrator creates in
 * the Studio and assigns to backend users - which sites, which branches of
 * the page tree, which dimensions, which workspaces. How the shell evaluates
 * them is in features/access/rules.ts.
 */

/** The role catalogue, with what applies to all roles in meta. Administrators only. */
export function useAccessRoles(enabled = true) {
  return useQuery({
    queryKey: studioKeys.access.roles,
    queryFn: enabled
      ? ({ signal }) => unwrap(api.GET('/accessroles', { signal }))
      : skipToken,
  })
}

/**
 * The caller's own effective access. Granted to every editor - it describes
 * the restrictions they are already living inside.
 */
export function useMyAccess(enabled = true) {
  return useQuery({
    queryKey: studioKeys.access.mine,
    queryFn: enabled
      ? ({ signal }) => unwrap(api.GET('/access/me', { signal }))
      : skipToken,
    // Roles change rarely; a stale answer only means the UI catches up one
    // navigation later.
    staleTime: 5 * 60 * 1000,
  })
}

export function createAccessRole(input: AccessRoleCreate): Promise<AccessRole> {
  return unwrap(api.POST('/accessroles', { body: input }))
}

/** Partial update; "constraints" and "memberUserIds" each replace the whole set. */
export function updateAccessRole(
  roleId: string,
  input: AccessRoleUpdate,
): Promise<AccessRole> {
  return unwrap(
    api.PATCH('/accessroles/{accessRoleId}', {
      params: { path: { accessRoleId: roleId } },
      body: input,
    }),
  )
}

export async function deleteAccessRole(roleId: string): Promise<void> {
  await unwrap(
    api.DELETE('/accessroles/{accessRoleId}', {
      params: { path: { accessRoleId: roleId } },
    }),
  )
}
