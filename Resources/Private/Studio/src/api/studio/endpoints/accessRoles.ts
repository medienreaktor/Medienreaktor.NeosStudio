import { useQuery } from '@tanstack/react-query'
import { studioFetch } from '../client'
import { studioKeys } from '../keys'
import type {
  AccessRole,
  AccessRoleCreate,
  AccessRoleListing,
  AccessRoleUpdate,
  MyAccess,
} from '../schema'

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
    queryFn: () => studioFetch<AccessRoleListing>('/accessroles'),
    enabled,
  })
}

function myAccessQuery() {
  return {
    queryKey: studioKeys.access.mine,
    queryFn: () => studioFetch<MyAccess>('/access/me'),
    // Roles change rarely; a stale answer only means the UI catches up one
    // navigation later.
    staleTime: 5 * 60 * 1000,
  }
}

/**
 * The caller's own effective access. Granted to every editor - it describes
 * the restrictions they are already living inside.
 */
export function useMyAccess(enabled = true) {
  return useQuery({ ...myAccessQuery(), enabled })
}

export function createAccessRole(input: AccessRoleCreate) {
  return studioFetch<AccessRole>('/accessroles', {
    method: 'POST',
    body: input,
  })
}

/** Partial update; "constraints" and "memberUserIds" each replace the whole set. */
export function updateAccessRole(roleId: string, input: AccessRoleUpdate) {
  return studioFetch<AccessRole>(`/accessroles/${encodeURIComponent(roleId)}`, {
    method: 'PATCH',
    body: input,
  })
}

export function setAccessRoleMembers(roleId: string, userIds: string[]) {
  return studioFetch<AccessRole>(
    `/accessroles/${encodeURIComponent(roleId)}/members`,
    { method: 'PUT', body: { userIds } },
  )
}

export function deleteAccessRole(roleId: string) {
  return studioFetch<null>(`/accessroles/${encodeURIComponent(roleId)}`, {
    method: 'DELETE',
  })
}
