import type {
  AccessCapability,
  AccessRoleConstraints,
  EffectiveAccess,
} from '@/api/studio/schema'

/**
 * Evaluating the Studio's access roles in the shell. The convention
 * throughout is **empty means unrestricted**: an empty site list is every
 * site, an empty rule list is the whole tree, an absent dimension key is
 * every value.
 *
 * The helpers mirror the server's (Domain/Model/AccessRoleConstraints.php)
 * exactly. They exist because the shell shapes its UI from them dozens of
 * times per render - hiding sites, greying out tree rows, disabling the
 * publish button - which no round trip could keep up with. The server is
 * still the authority: it re-checks every write, and these helpers only ever
 * decide what to *show*.
 */

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

function listAllowsWorkspace(
  c: AccessRoleConstraints,
  workspaceName: string,
): boolean {
  return (
    c.workspaceNames.length === 0 || c.workspaceNames.includes(workspaceName)
  )
}

/**
 * A workspace classification as the rules compare it: lowercase, the way
 * Neos.Api's Workspace has it ('root' | 'personal' | 'shared' | 'unknown').
 * The server's PHP side spells them in uppercase (ROOT, PERSONAL, ...), so
 * either spelling is accepted.
 */
function normalizedClassification(classification: string): string {
  return classification.toLowerCase()
}

function roleAllowsWorkspaceRead(
  c: AccessRoleConstraints,
  workspaceName: string,
  classification: string,
): boolean {
  const normalized = normalizedClassification(classification)
  if (normalized === 'personal') return c.allowPersonalWorkspace
  if (normalized === 'shared') return listAllowsWorkspace(c, workspaceName)
  // Root workspaces (live above all) stay READABLE for everyone: the frontend
  // renders from live, so cutting it off would take the website down for the
  // members rather than narrowing their editing.
  return true
}

function roleAllowsWorkspaceEditing(
  c: AccessRoleConstraints,
  workspaceName: string,
  classification: string,
): boolean {
  if (normalizedClassification(classification) === 'personal')
    return c.allowPersonalWorkspace
  // Live gets no exemption here: "restricted to Entwurf" has to also mean
  // "cannot switch back to live and work there". An empty list still means
  // every workspace, live included.
  return listAllowsWorkspace(c, workspaceName)
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

/**
 * What one operation touches. Absent fields are axes the operation does not
 * have - creating a workspace has no node, so page-tree rules must not veto
 * it.
 */
export interface AccessRequest {
  siteNodeName?: string
  /** Node aggregate id first, then its ancestors outwards. */
  idPath?: string[]
  dimensionCoordinates?: Record<string, string>
  workspaceName?: string
  /**
   * Neos.Api's Workspace classification: root, personal, shared or unknown
   * (compared case-insensitively).
   */
  workspaceClassification?: string
  capability?: AccessCapability
}

/**
 * The authoritative check, mirroring EffectiveAccess::permits(): is there ONE
 * role that permits this operation on every axis at once?
 *
 * The single-axis helpers below answer "could any role allow this at all",
 * which is what shaping a list needs. Deciding whether an editing affordance
 * may be offered is this one - OR-ing the axes separately lets a role granting
 * only the workspace combine with one granting only the writing, and the UI
 * offers exactly what the server then refuses.
 */
export function permits(
  access: EffectiveAccess | undefined,
  request: AccessRequest,
): boolean {
  return anyRole(access, (c) => {
    if (request.siteNodeName && !roleAllowsSite(c, request.siteNodeName))
      return false
    if (request.idPath?.length && !roleAllowsNodePath(c, request.idPath))
      return false
    if (
      request.dimensionCoordinates &&
      Object.keys(request.dimensionCoordinates).length > 0 &&
      !roleAllowsDimensions(c, request.dimensionCoordinates)
    ) {
      return false
    }
    if (
      request.workspaceName !== undefined &&
      !roleAllowsWorkspaceEditing(
        c,
        request.workspaceName,
        request.workspaceClassification ?? 'unknown',
      )
    ) {
      return false
    }
    if (
      request.capability !== undefined &&
      c.capabilities[request.capability] === false
    ) {
      return false
    }
    return true
  })
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

/** May the account SEE this workspace's content? */
export function allowsWorkspaceRead(
  access: EffectiveAccess | undefined,
  workspaceName: string,
  classification: string,
): boolean {
  return anyRole(access, (c) =>
    roleAllowsWorkspaceRead(c, workspaceName, classification),
  )
}

/**
 * May the account WORK in it - edit in it, target it as a publish base, join
 * it collaboratively? The workspace switcher offers exactly these.
 */
export function allowsWorkspaceEditing(
  access: EffectiveAccess | undefined,
  workspaceName: string,
  classification: string,
): boolean {
  return anyRole(access, (c) =>
    roleAllowsWorkspaceEditing(c, workspaceName, classification),
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
