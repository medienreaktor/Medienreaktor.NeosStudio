import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { setActiveContentRepositoryId } from '@/api/neos/activeContentRepository'
import { useContentRepository } from '@/api/neos/endpoints/contentRepositories'
import { useSites } from '@/api/neos/endpoints/sites'
import {
  ensurePersonalWorkspace,
  useWorkspaces,
} from '@/api/neos/endpoints/workspaces'
import { neosKeys } from '@/api/neos/keys'
import {
  parseDimensionSpacePoint,
  sameDimensionSpacePoint,
  type ContentDimension,
  type ContentRepository,
  type Site,
  type Workspace,
} from '@/api/neos/schema'
import { useMyAccess } from '@/api/studio/endpoints/accessRoles'
import type { EffectiveAccess } from '@/api/studio/schema'
import { queryClient } from '@/app/queryClient'
import { deepLinkTarget } from '@/app/deepLink'
import { readStored, writeStored } from '@/app/storage'
import {
  allowsDimensionSpacePoint,
  allowsSite,
  allowsWorkspaceEditing,
} from '@/features/access/rules'
import {
  useActiveSiteForAccess,
  useWorkspaceClassificationsForAccess,
} from '@/features/access/useAccess'

// Remember the site and dimension the user was working in across reloads.
const SELECTED_SITE_KEY = 'neos-studio.selected_site'
const DIMENSION_SPACE_POINT_KEY = 'neos-studio.dimension_space_point'

// Remember a collaborative editing context (a shared workspace edited
// directly) across reloads; absent = the personal workspace.
const EDITING_WORKSPACE_KEY = 'neos-studio.editing_workspace'

// One empty list for "not loaded", so it does not change identity per render
// (the access hooks below refresh the tree decorations whenever it does).
const NO_WORKSPACES: Workspace[] = []

// The stored point (JSON), or null (= the active site's default) if nothing
// valid is stored. Structural check only - whether the point is still allowed
// by the dimension configuration is verified once the dimensions load.
function storedDimensionSpacePoint(): string | null {
  const stored = readStored(DIMENSION_SPACE_POINT_KEY)
  if (!stored) return null
  try {
    const parsed: unknown = JSON.parse(stored)
    if (
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      Object.values(parsed).every((value) => typeof value === 'string')
    ) {
      return stored
    }
  } catch {
    /* fall through to the backend default */
  }
  return null
}

/** A shared workspace the account may edit in directly (collaboratively). */
function isCollaborativeTarget(
  workspace: Workspace,
  access: EffectiveAccess | undefined,
): boolean {
  return (
    workspace.classification === 'shared' &&
    workspace.permissions.write &&
    allowsWorkspaceEditing(access, workspace.name, workspace.classification)
  )
}

export type EditingContext = {
  /** The online sites the account may open, empty while unknown. */
  sites: Site[]
  /** The active site, null while sites (or the access roles) load. */
  site: Site | null
  /** Sites have loaded, but there is none the account may open. */
  noSiteToOpen: boolean
  /** Every workspace of the active site's content repository. */
  workspaces: Workspace[]
  /** The own personal workspace, null while workspaces load. */
  personalWorkspace: Workspace | null
  /** The shared workspace edited directly, null in the classic model. */
  collaborativeWorkspace: Workspace | null
  /** Where editing happens: the collaborative workspace, else the personal one. */
  activeWorkspace: Workspace | null
  /** The workspaces the switcher may offer as publish base or editing context. */
  baseTargets: Workspace[]
  contentRepository: ContentRepository | undefined
  dimensions: ContentDimension[]
  /** The configured dimension space points the access roles allow editing in. */
  allowedEditablePoints: string[]
  /** The dimension space point the shell browses and edits in (JSON). */
  dimensionSpacePoint: string | null
  /** Switch the site; the caller resets the selection. */
  selectSite: (site: Site) => void
  /** Edit in a shared workspace (name), or back in the personal one (null). */
  setEditingWorkspace: (name: string | null) => void
  setDimensionSpacePoint: (point: string) => void
}

/**
 * The editing context: which site, workspace and dimension space point the
 * shell works in. Each is the user's choice (remembered across reloads)
 * narrowed during render by what is actually there and what the access roles
 * allow - a remembered choice that no longer resolves falls back to the
 * default without being forgotten in state, and the effects only persist.
 *
 * Nothing resolves until the own access roles have answered (or failed to):
 * the access checks answer "allowed" while they are unknown, and a context
 * derived from that - a withheld personal workspace, a forbidden site or
 * dimension - would be thrown away a moment later, together with whatever
 * selection was restored into it.
 */
export function useEditingContext(): EditingContext {
  // The dynamic access roles assigned to this user, if any. Everything below
  // narrows by them; unrestricted users (and administrators) see every check
  // answer "yes", so the shell behaves exactly as it did without the feature.
  const accessQuery = useMyAccess()
  const access = accessQuery.data
  const accessSettled = accessQuery.status !== 'pending'

  // --- Site ---

  const { data: allSites } = useSites()
  // The editing shell only deals in online sites; offline ones exist solely
  // for the sites administration (which fetches the full listing itself).
  // Sites outside the user's access roles drop out here, which is all it
  // takes: the switcher, the tree and the restored selection all read this.
  const sites = useMemo(
    () =>
      accessSettled
        ? (allSites ?? []).filter(
            (site) => site.online && allowsSite(access, site.nodeName),
          )
        : [],
    [allSites, access, accessSettled],
  )
  // Starts from the site remembered across reloads; a stored name that no
  // longer matches simply falls back to the first site below.
  const [siteNodeName, setSiteNodeName] = useState<string | null>(() =>
    readStored(SELECTED_SITE_KEY),
  )
  const site =
    sites.find((s) => s.nodeName === siteNodeName) ??
    sites.find((s) => s.nodeAggregateId !== null) ??
    null
  // Nothing to preview (no online site the account may open): the boot
  // screen would otherwise wait for a page that never comes.
  const noSiteToOpen = allSites !== undefined && accessSettled && site === null

  useEffect(() => {
    if (siteNodeName) writeStored(SELECTED_SITE_KEY, siteNodeName)
  }, [siteNodeName])

  // Site restrictions are per site, and the synchronous consumers (the tree
  // row decorator) only ever see a bare node - tell them which site is open.
  useActiveSiteForAccess(site?.nodeName ?? null)

  // Workspaces, node types, dimensions and tasks are those of the selected
  // site's content repository - its reads wait for it. A user's site switch
  // sets it right in the handler (selectSite), together with the new site;
  // this layout effect covers the derived changes (the first site resolving,
  // a remembered site falling away) before anything is painted with the
  // previous one.
  const contentRepositoryId = site?.contentRepositoryId ?? null
  useLayoutEffect(() => {
    setActiveContentRepositoryId(contentRepositoryId)
  }, [contentRepositoryId])

  // Editing happens in the personal workspace by default - provision it if
  // the account has none yet in this content repository, then re-read the
  // list so it shows up.
  useEffect(() => {
    if (contentRepositoryId === null) return
    void ensurePersonalWorkspace(contentRepositoryId).then(() =>
      queryClient.invalidateQueries({
        queryKey: neosKeys.workspaces.list(contentRepositoryId),
      }),
    )
  }, [contentRepositoryId])

  // --- Workspace ---

  // The editing context. Default (classic model): editing happens in the
  // personal workspace and the switcher only retargets where a publish goes
  // (rebases the personal workspace onto a different base). Collaborative
  // model: the switcher can instead point the editing context AT a shared
  // workspace - every command then runs directly against it, which is what
  // makes multiplayer editing work (all participants write into one event
  // log). Switching the editing context is a pure client-side state change:
  // no CR command, no empty-workspace requirement, personal pending changes
  // survive untouched.
  const { data: workspacesResponse } = useWorkspaces()
  const workspaces = workspacesResponse ?? NO_WORKSPACES
  const [editingWorkspaceName, setEditingWorkspaceName] = useState<
    string | null
  >(() => readStored(EDITING_WORKSPACE_KEY))
  const personalWorkspace = accessSettled
    ? (workspaces.find((w) => w.classification === 'personal') ?? null)
    : null
  // A remembered collaborative context that no longer resolves (workspace
  // deleted, write access revoked) falls back to the personal workspace.
  const requestedWorkspace =
    accessSettled && editingWorkspaceName !== null
      ? (workspaces.find(
          (w) =>
            w.name === editingWorkspaceName && isCollaborativeTarget(w, access),
        ) ?? null)
      : null
  // A role can withhold the personal workspace, which is the shell's default
  // editing context - such a user has to work directly in a shared workspace:
  // the first one they may write to, rather than one every read of which is
  // refused.
  const personalWithheld =
    personalWorkspace !== null &&
    !allowsWorkspaceEditing(access, personalWorkspace.name, 'personal')
  const collaborativeWorkspace =
    requestedWorkspace ??
    (personalWithheld
      ? (workspaces.find((w) => isCollaborativeTarget(w, access)) ?? null)
      : null)
  const activeWorkspace = collaborativeWorkspace ?? personalWorkspace
  // Workspaces an access role excludes never reach the switcher - the content
  // repository refuses to read them anyway, so offering them would only ever
  // produce an error.
  const baseTargets = useMemo(
    () =>
      workspaces.filter(
        (w) =>
          (w.classification === 'root' || w.classification === 'shared') &&
          allowsWorkspaceEditing(access, w.name, w.classification),
      ),
    [workspaces, access],
  )

  // Remember the context the shell actually edits in - which also forgets a
  // remembered one that no longer resolves, and remembers the fallback of a
  // withheld personal workspace.
  const collaborativeWorkspaceName = collaborativeWorkspace?.name ?? null
  useEffect(() => {
    if (!workspacesResponse || !accessSettled) return
    writeStored(EDITING_WORKSPACE_KEY, collaborativeWorkspaceName)
  }, [workspacesResponse, accessSettled, collaborativeWorkspaceName])

  // Same reason as the site above: a node names its workspace, not how that
  // workspace is classified - and live is treated differently from shared
  // and personal.
  useWorkspaceClassificationsForAccess(workspaces)

  // --- Dimension ---

  const { data: contentRepository } = useContentRepository()
  const dimensions = contentRepository?.dimensions ?? []
  // null = the active site's default dimension space point, which the
  // switcher then shows. Starts from the dimension a deep link asked for,
  // else the point remembered across reloads.
  const [requestedPoint, setRequestedPoint] = useState<string | null>(
    () => deepLinkTarget?.dimensionSpacePoint ?? storedDimensionSpacePoint(),
  )
  const allowedPoints = contentRepository?.dimensionSpacePoints
  // Dimensions an access role excludes never reach the switcher. Same
  // reasoning as the workspaces: the content repository would refuse the
  // write, so offering the switch only produces an error later.
  const allowedEditablePoints = useMemo(
    () =>
      (allowedPoints ?? []).filter((point) =>
        allowsDimensionSpacePoint(access, parseDimensionSpacePoint(point)),
      ),
    [allowedPoints, access],
  )
  // A requested point that the dimension configuration no longer allows
  // (config changed since it was stored) - or the access roles forbid, a
  // deep-linked one included - gives way to the site's default. Until the
  // configuration has loaded, the request is taken at its word.
  const requestedPointAllowed =
    requestedPoint !== null &&
    (allowedPoints === undefined ||
      allowedEditablePoints.some((point) =>
        sameDimensionSpacePoint(point, requestedPoint),
      ))
  const dimensionSpacePoint =
    accessSettled && site !== null
      ? requestedPointAllowed
        ? requestedPoint
        : site.defaultDimensionSpacePoint
      : null

  // Remember the dimension across reloads - and forget one that gave way.
  useEffect(() => {
    if (requestedPoint === null || allowedPoints === undefined) return
    if (!accessSettled) return
    writeStored(
      DIMENSION_SPACE_POINT_KEY,
      requestedPointAllowed ? requestedPoint : null,
    )
  }, [requestedPoint, requestedPointAllowed, allowedPoints, accessSettled])

  return {
    sites,
    site,
    noSiteToOpen,
    workspaces,
    personalWorkspace,
    collaborativeWorkspace,
    activeWorkspace,
    baseTargets,
    contentRepository,
    dimensions,
    allowedEditablePoints,
    dimensionSpacePoint,
    selectSite: (next) => {
      setSiteNodeName(next.nodeName)
      // Synchronously, in the same batch as the site: every read of the
      // content repository renders against the new one right away.
      setActiveContentRepositoryId(next.contentRepositoryId)
    },
    setEditingWorkspace: setEditingWorkspaceName,
    setDimensionSpacePoint: setRequestedPoint,
  }
}
