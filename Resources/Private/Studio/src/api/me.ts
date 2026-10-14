import { useQuery } from '@tanstack/react-query'
import { queryClient } from '@/app/queryClient'
import { config } from '@/config'
import type { MyAccessResponse } from './accessRoles'
import { apiFetch, studioFetch } from './client'
import { queryKeys } from './keys'

/** Neos.Api's GET /me. */
interface CurrentAccount {
  account: { identifier: string; roles: string[] }
  user: { id: string; label: string } | null
  token: { client: string; scopes: string[] }
  /**
   * Every Neos.Api scope whose privilege the account is granted - what the
   * account may do, independent of the token's scopes.
   */
  privileges?: string[]
}

export interface Me {
  /** The account identifier (the username). */
  account: string | null
  /**
   * The Neos user behind the account - the id matches the content
   * repository's initiatingUserId event metadata and the presence roster, so
   * the client can tell its own changes from colleagues'. null for
   * non-user-bound authentications (client credentials).
   */
  user: { id: string; label: string } | null
  roles: string[]
  scopes: string[]
  client: string | null
  contentRepository: string
  /** The Neos.Api privileges (scope names) the account is granted. */
  privileges: string[]
  /**
   * Capability flags the shell gates its administration sections by -
   * derived from the account's Neos.Api privileges (and, for the access
   * roles, the Studio's own access endpoint).
   */
  permissions: {
    media: boolean
    users: boolean
    sites: boolean
    workspaces: boolean
    accessRoles: boolean
    administration: boolean
  }
}

/**
 * Whether the account may administer the Studio's access roles. Shares the
 * cached /access/me answer; a failure only hides the section.
 */
async function canAdministerAccessRoles(): Promise<boolean> {
  try {
    const access = await queryClient.fetchQuery({
      queryKey: queryKeys.myAccess,
      queryFn: () => studioFetch<MyAccessResponse>('/access/me'),
      staleTime: 5 * 60 * 1000,
    })
    return access.canAdminister === true
  } catch {
    return false
  }
}

async function fetchMe(): Promise<Me> {
  const [current, accessRoles] = await Promise.all([
    apiFetch<CurrentAccount>('/me'),
    canAdministerAccessRoles(),
  ])
  const privileges = current.privileges ?? []
  const has = (privilege: string) => privileges.includes(privilege)
  const users = has('users.read') || has('users.update')
  const sites = has('sites.update')
  return {
    account: current.account?.identifier ?? null,
    user: current.user
      ? { id: current.user.id, label: current.user.label }
      : null,
    roles: current.account?.roles ?? [],
    scopes: current.token?.scopes ?? [],
    client: current.token?.client ?? null,
    contentRepository: config.contentRepositoryId,
    privileges,
    permissions: {
      media: has('assets.read'),
      users,
      sites,
      // The classic Workspaces module is open to every editor - the closest
      // privilege is the one to create workspaces (granted to all editors).
      workspaces: has('workspaces.create'),
      accessRoles,
      administration: users || sites,
    },
  }
}

export function useMe(enabled = true) {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: fetchMe,
    enabled,
  })
}
