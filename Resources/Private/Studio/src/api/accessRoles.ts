import { useQuery } from '@tanstack/react-query'
import { apiFetch } from './client'
import { queryKeys } from './keys'

/**
 * Dynamic access roles: named restriction sets an administrator creates in
 * the Studio and assigns to backend users - which sites, which branches of
 * the page tree, which dimensions, which workspaces.
 *
 * The convention throughout is **empty means unrestricted**: an empty site
 * list is every site, an empty rule list is the whole tree, an absent
 * dimension key is every value. A new role therefore starts out granting
 * everything and is narrowed field by field.
 *
 * The evaluation helpers at the bottom mirror the server's
 * (Domain/Model/AccessRoleConstraints.php) exactly. They exist because the
 * shell shapes its UI from them dozens of times per render - hiding sites,
 * greying out tree rows, disabling the publish button - which no round trip
 * could keep up with. The server is still the authority: it re-checks every
 * write, and these helpers only ever decide what to *show*.
 */

/** One page-tree rule: allow or deny a document, by default including everything below it. */
export interface NodeTreeRule {
  mode: 'ALLOW' | 'DENY'
  /** The site the document belongs to - groups the rules in the UI. */
  siteNodeName: string
  nodeAggregateId: string
  /** Denormalised at pick time, for listing a role without resolving nodes. */
  label: string
  path: string
  /** false narrows the rule to exactly this one document. */
  includeDescendants: boolean
}

/** Capability names the server currently knows; the listing endpoint reports them. */
export type AccessCapability =
  | 'editNodes'
  | 'createNodes'
  | 'deleteNodes'
  | 'moveNodes'

export interface AccessRoleConstraints {
  /** Empty = every site. */
  siteNodeNames: string[]
  /** Empty = the whole page tree. */
  nodeTreeRules: NodeTreeRule[]
  /** dimension id => allowed values; an absent key means every value. */
  dimensionValues: Record<string, string[]>
  /** Shared workspaces the role may use; empty = all of them. */
  workspaceNames: string[]
  allowPersonalWorkspace: boolean
  allowPublishToLive: boolean
  allowWorkspaceCreation: boolean
  /** Only withheld capabilities are listed (value false); absent = granted. */
  capabilities: Partial<Record<AccessCapability, boolean>>
}

export interface AccessRole {
  id: string
  identifier: string
  label: string
  description: string
  active: boolean
  /** Whether the role narrows anything at all - drives the "unrestricted" badge. */
  restricting: boolean
  constraints: AccessRoleConstraints
  memberUserIds: string[]
  createdAt: string
  updatedAt: string
}

export interface AccessRolesResponse {
  roles: AccessRole[]
  capabilities: AccessCapability[]
  /** Flow roles exempt from access control - administrators by default. */
  bypassRoles: string[]
  /** False = the roles only shape the UI, the write path is not narrowed. */
  enforcedInContentRepository: boolean
}

/** One role as it reaches an editor through /access/me - no membership, no metadata. */
export interface EffectiveAccessRole {
  id: string
  identifier: string
  label: string
  constraints: AccessRoleConstraints
}

export interface EffectiveAccess {
  /** True for administrators and for users without any assigned role. */
  unrestricted: boolean
  reason: string
  /**
   * The assigned roles, each complete. Roles are additive and every question
   * is answered by OR-ing them, which cannot be expressed as one merged
   * constraint set - a merged page-tree rule list would let one role's DENY
   * cut into a branch another role grants.
   */
  roles: EffectiveAccessRole[]
  /**
   * Node aggregate ids of every ancestor of every granted branch. They are
   * not granted themselves, but the tree shows them read-only anyway - a role
   * granting "Products / Pumps" grants neither "Products" nor the site node,
   * and hiding those would leave the editor with an empty tree and no way
   * down to the one branch they may edit. Resolved server-side per request,
   * because ancestry changes whenever a page is moved.
   */
  pathAnchors: string[]
}

export interface MyAccessResponse {
  access: EffectiveAccess
  capabilities: AccessCapability[]
}

/** The role catalogue. Administrators only; callers gate on me.permissions.accessRoles. */
export function useAccessRoles(enabled = true) {
  return useQuery({
    queryKey: queryKeys.accessRoles,
    queryFn: () => apiFetch<AccessRolesResponse>('/access/roles'),
    enabled,
  })
}

/**
 * The caller's own effective access. Granted to every editor - it describes
 * the restrictions they are already living inside. Long-lived: roles change
 * rarely and a stale answer only ever means the UI catches up one navigation
 * later.
 */
export function useMyAccess(enabled = true) {
  return useQuery({
    queryKey: queryKeys.myAccess,
    queryFn: () => apiFetch<MyAccessResponse>('/access/me'),
    staleTime: 5 * 60 * 1000,
    enabled,
  })
}

export interface AccessRoleInput {
  label?: string
  description?: string
  identifier?: string
  constraints?: AccessRoleConstraints
  memberUserIds?: string[]
  active?: boolean
}

export function createAccessRole(input: AccessRoleInput) {
  return apiFetch<{ role: AccessRole }>('/access/roles', {
    method: 'POST',
    body: input,
  })
}

/** Partial update; "constraints" and "memberUserIds" each replace the whole set. */
export function updateAccessRole(roleId: string, input: AccessRoleInput) {
  return apiFetch<{ role: AccessRole }>(
    `/access/roles/${encodeURIComponent(roleId)}`,
    { method: 'PATCH', body: input },
  )
}

export function setAccessRoleMembers(roleId: string, userIds: string[]) {
  return apiFetch<{ role: AccessRole }>(
    `/access/roles/${encodeURIComponent(roleId)}/members`,
    { method: 'PUT', body: { userIds } },
  )
}

export function deleteAccessRole(roleId: string) {
  return apiFetch<{ success: boolean }>(
    `/access/roles/${encodeURIComponent(roleId)}`,
    { method: 'DELETE' },
  )
}

/** A role that restricts nothing - the starting point of every new role. */
export function unrestrictedConstraints(): AccessRoleConstraints {
  return {
    siteNodeNames: [],
    nodeTreeRules: [],
    dimensionValues: {},
    workspaceNames: [],
    allowPersonalWorkspace: true,
    allowPublishToLive: true,
    allowWorkspaceCreation: true,
    capabilities: {},
  }
}

// --- Evaluation ------------------------------------------------------------
// Mirrors Domain/Model/AccessRoleConstraints.php. Keep the two in step.

function roleAllowsSite(
  c: AccessRoleConstraints,
  siteNodeName: string,
): boolean {
  return c.siteNodeNames.length === 0 || c.siteNodeNames.includes(siteNodeName)
}

function roleAllowsDimensions(
  c: AccessRoleConstraints,
  coordinates: Record<string, string>,
): boolean {
  return Object.entries(c.dimensionValues).every(([dimensionId, values]) => {
    if (values.length === 0) return true
    // A point that does not mention the restricted dimension cannot violate
    // the restriction - it is not in that space.
    const value = coordinates[dimensionId]
    return value === undefined || values.includes(value)
  })
}

function roleAllowsWorkspace(
  c: AccessRoleConstraints,
  workspaceName: string,
  classification: string,
): boolean {
  if (classification === 'PERSONAL') return c.allowPersonalWorkspace
  if (classification === 'SHARED')
    return (
      c.workspaceNames.length === 0 || c.workspaceNames.includes(workspaceName)
    )
  // Root workspaces (live above all) stay available for everyone.
  return true
}

/**
 * Walk the chain outwards; the first rule that matches is the nearest one and
 * wins. That single property gives the combination everyone expects: allow a
 * branch, deny a page inside it, allow a page below that again.
 *
 * With nothing matching, allow rules act as a whitelist (the rest of the tree
 * is closed) and a pure deny list leaves it open.
 *
 * @param idPath node aggregate id first, then its ancestors outwards
 */
function roleAllowsNodePath(
  c: AccessRoleConstraints,
  idPath: string[],
): boolean {
  if (c.nodeTreeRules.length === 0) return true
  for (let distance = 0; distance < idPath.length; distance++) {
    for (const rule of c.nodeTreeRules) {
      if (
        rule.nodeAggregateId === idPath[distance] &&
        (distance === 0 || rule.includeDescendants)
      ) {
        return rule.mode === 'ALLOW'
      }
    }
  }
  return !c.nodeTreeRules.some((rule) => rule.mode === 'ALLOW')
}

function anyRole(
  access: EffectiveAccess | undefined,
  predicate: (c: AccessRoleConstraints) => boolean,
): boolean {
  if (!access || access.unrestricted) return true
  return access.roles.some((role) => predicate(role.constraints))
}

export function allowsSite(
  access: EffectiveAccess | undefined,
  siteNodeName: string,
): boolean {
  return anyRole(access, (c) => roleAllowsSite(c, siteNodeName))
}

export function allowsDimensionSpacePoint(
  access: EffectiveAccess | undefined,
  coordinates: Record<string, string>,
): boolean {
  return anyRole(access, (c) => roleAllowsDimensions(c, coordinates))
}

export function allowsWorkspace(
  access: EffectiveAccess | undefined,
  workspaceName: string,
  classification: string,
): boolean {
  return anyRole(access, (c) =>
    roleAllowsWorkspace(c, workspaceName, classification),
  )
}

export function allowsPublishToLive(
  access: EffectiveAccess | undefined,
): boolean {
  return anyRole(access, (c) => c.allowPublishToLive)
}

export function allowsWorkspaceCreation(
  access: EffectiveAccess | undefined,
): boolean {
  return anyRole(access, (c) => c.allowWorkspaceCreation)
}

export function allowsCapability(
  access: EffectiveAccess | undefined,
  capability: AccessCapability,
): boolean {
  return anyRole(access, (c) => c.capabilities[capability] !== false)
}

/**
 * The full node check: the site AND the position in the page tree, evaluated
 * inside one role - a role granting the branch but not the site must not
 * combine with another role the other way round.
 *
 * @param idPath node aggregate id first, then its ancestors outwards
 */
export function allowsNode(
  access: EffectiveAccess | undefined,
  idPath: string[],
  siteNodeName: string,
): boolean {
  return anyRole(
    access,
    (c) =>
      (siteNodeName === '' || roleAllowsSite(c, siteNodeName)) &&
      roleAllowsNodePath(c, idPath),
  )
}

/**
 * What one role has to say about a node: it grants it, it explicitly refuses
 * it, or the node simply falls outside the branches the role whitelists.
 */
type RoleVerdict = 'allow' | 'deny' | 'outside'

function roleVerdict(c: AccessRoleConstraints, idPath: string[]): RoleVerdict {
  if (c.nodeTreeRules.length === 0) return 'allow'
  for (let distance = 0; distance < idPath.length; distance++) {
    for (const rule of c.nodeTreeRules) {
      if (
        rule.nodeAggregateId === idPath[distance] &&
        (distance === 0 || rule.includeDescendants)
      ) {
        return rule.mode === 'ALLOW' ? 'allow' : 'deny'
      }
    }
  }
  // Nothing matched: a pure deny list leaves the rest of the tree open, allow
  // rules turn it into a whitelist and this node is not on it.
  return c.nodeTreeRules.some((rule) => rule.mode === 'ALLOW')
    ? 'outside'
    : 'allow'
}

/**
 * How a page-tree row should be treated:
 *
 * - `allowed` — a role covers it; edit normally.
 * - `restricted` — not granted, but on the way to something that is (see
 *   `pathAnchors`). Shown dimmed and locked: it is a signpost, not a
 *   workspace.
 * - `hidden` — not granted and not on the way anywhere. The row goes away
 *   entirely; there is nothing an editor could do with it and nothing below
 *   it they could reach.
 *
 * Note that an explicitly denied page still shows as `restricted` when a
 * deeper page inside it IS granted - "deny the section, allow one page in
 * it" has to stay reachable to mean anything.
 *
 * @param idPath node aggregate id first, then its ancestors outwards
 */
export function nodeAccessState(
  access: EffectiveAccess | undefined,
  idPath: string[],
  siteNodeName: string,
): 'allowed' | 'restricted' | 'hidden' {
  if (!access || access.unrestricted) return 'allowed'

  // A role that does not cover this site has no opinion about pages in it.
  const applicable = access.roles.filter(
    (role) =>
      siteNodeName === '' || roleAllowsSite(role.constraints, siteNodeName),
  )
  if (applicable.length === 0) return 'hidden'

  const verdicts = applicable.map((role) =>
    roleVerdict(role.constraints, idPath),
  )
  if (verdicts.includes('allow')) return 'allowed'

  // Not granted - so it only earns a row if something granted lives below it.
  return (access.pathAnchors ?? []).includes(idPath[0])
    ? 'restricted'
    : 'hidden'
}
