import { useLayoutEffect } from 'react'
import { hashKey } from '@tanstack/react-query'

import { observedIdPath, useNodeAncestors } from '@/api/neos/endpoints/nodes'
import {
  nodeAddressOf,
  parseDimensionSpacePoint,
  type Node,
  type Workspace,
} from '@/api/neos/schema'
import { useMyAccess } from '@/api/studio/endpoints/accessRoles'
import { studioKeys } from '@/api/studio/keys'
import type { AccessCapability, EffectiveAccess } from '@/api/studio/schema'
import { queryClient } from '@/app/queryClient'
import { nodeDecoratorRegistry } from '@/features/tree/decorators'
import { nodeAccessState, permits } from './rules'

/**
 * The acting user's effective access, for render-time hooks and for the
 * synchronous consumers alike.
 *
 * Node decorators are pure `(node) => decoration` functions called during
 * render for every visible row - they have no place to call a hook and no
 * props to receive access through. They read the access straight from the
 * query cache (never a copy that lags a commit behind), and the decorator
 * registry is refreshed whenever it - or the site / workspace context below -
 * changes, so the rows decorate again.
 *
 * Until /access/me has answered, access is *unknown*, and every consumer
 * treats it the same way: what is SHOWN fails open (no row is hidden or
 * locked only to be revealed a moment later), what may be WRITTEN fails
 * closed (no editor, menu action or drop is offered that the server might
 * then refuse).
 */

const ACCESS_QUERY_HASH = hashKey(studioKeys.access.mine)

/** The settled effective access, or undefined while it is still unknown. */
function knownAccess(): EffectiveAccess | undefined {
  return queryClient.getQueryData<EffectiveAccess>(studioKeys.access.mine)
}

let activeSiteNodeName = ''
let workspaceClassifications = new Map<string, string>()

// Re-decorate whenever the cached access changes - refetched, invalidated
// after a role edit, or dropped on logout.
let lastSeenAccess: EffectiveAccess | undefined
queryClient.getQueryCache().subscribe((event) => {
  if (event.query.queryHash !== ACCESS_QUERY_HASH) return
  const access = event.query.state.data as EffectiveAccess | undefined
  if (access === lastSeenAccess) return
  lastSeenAccess = access
  nodeDecoratorRegistry.refresh()
})

/**
 * Subscribe to the own effective access. Safe to call from anywhere - the
 * query is deduplicated, so extra callers cost nothing.
 */
export function useAccess(enabled = true): EffectiveAccess | undefined {
  return useMyAccess(enabled).data
}

/**
 * Tell the synchronous consumers which site the shell is showing. Called once
 * by the App: site restrictions are per site, and a decorator looking at a
 * bare node has no way to tell which one it belongs to.
 *
 * A layout effect, so the rows re-decorated by the refresh are on screen in
 * the same paint as the site switch.
 */
export function useActiveSiteForAccess(siteNodeName: string | null): void {
  useLayoutEffect(() => {
    activeSiteNodeName = siteNodeName ?? ''
    nodeDecoratorRegistry.refresh()
  }, [siteNodeName])
}

/**
 * Tell the synchronous consumers how each workspace is classified. Access
 * roles treat live (root) differently from shared and personal ones, and a
 * node carries only its workspace's NAME.
 */
export function useWorkspaceClassificationsForAccess(
  workspaces: Pick<Workspace, 'name' | 'classification'>[],
): void {
  useLayoutEffect(() => {
    workspaceClassifications = new Map(
      workspaces.map((workspace) => [workspace.name, workspace.classification]),
    )
    nodeDecoratorRegistry.refresh()
  }, [workspaces])
}

/**
 * How a document should be treated in the trees, from the ancestry observed
 * while loading them. Documents reached without their ancestry known resolve
 * against a short path, which can only ever fail *open* (fewer ancestors =
 * fewer rules match = no rule matched = the tree stays visible) - and the
 * server still refuses the write.
 *
 * While access is unknown every document is `allowed`: this decides what is
 * shown, which fails open (see above).
 */
export function documentAccessState(
  node: Node,
  siteNodeName: string = activeSiteNodeName,
): 'allowed' | 'restricted' | 'hidden' {
  return nodeAccessState(
    knownAccess(),
    observedIdPath(nodeAddressOf(node)),
    siteNodeName,
  )
}

/**
 * Whether this node may be edited - the gate every editing surface asks
 * before offering anything (the inspector, the preview's inline editing, the
 * context menus).
 *
 * Unlike the tree decoration above this does NOT settle for observed
 * ancestry. A row in the tree was always walked to from the top, so its
 * ancestors are known; a node reached any other way - restored from
 * localStorage on reload, clicked in the preview, followed from a link - has
 * none, and an ancestor-relative rule evaluated against a one-element path
 * answers by accident. Editing is the decision that must not be accidental,
 * so it asks the server for the real chain (cached per address, and only ever
 * fetched for accounts a role actually restricts).
 *
 * Fails closed while access or that chain is unknown - in flight or failed:
 * for a restricted account the brief lock resolves into an unlocked editor,
 * whereas the other way round hands out an editor whose save the server
 * would refuse.
 */
export function useNodeEditable(
  node: Node | null,
  capability: AccessCapability = 'editNodes',
): boolean {
  const access = useAccess()
  const restricted = access !== undefined && !access.unrestricted
  const {
    data: ancestors,
    isPending,
    isError,
  } = useNodeAncestors(restricted && node !== null ? nodeAddressOf(node) : null)

  if (node === null) return true
  if (access === undefined) return false
  if (!restricted) return true
  if (isPending || isError) return false

  return permits(access, {
    siteNodeName: activeSiteNodeName,
    idPath: [
      node.nodeAggregateId,
      ...(ancestors ?? []).map((ancestor) => ancestor.nodeAggregateId),
    ],
    dimensionCoordinates: parseDimensionSpacePoint(node.dimensionSpacePoint),
    workspaceName: node.workspaceName,
    workspaceClassification: classificationOf(node.workspaceName),
    capability,
  })
}

/**
 * The synchronous sibling of useNodeEditable, for the surfaces that cannot
 * call a hook per row (tree rows, drag-and-drop callbacks). Settles for the
 * observed ancestry, which those surfaces do have: they walked the tree down
 * to the node. False while access is unknown, like useNodeEditable.
 */
export function nodePermits(node: Node, capability: AccessCapability): boolean {
  const access = knownAccess()
  if (access === undefined) return false
  return permits(access, {
    siteNodeName: activeSiteNodeName,
    idPath: observedIdPath(nodeAddressOf(node)),
    dimensionCoordinates: parseDimensionSpacePoint(node.dimensionSpacePoint),
    workspaceName: node.workspaceName,
    workspaceClassification: classificationOf(node.workspaceName),
    capability,
  })
}

function classificationOf(workspaceName: string): string {
  return workspaceClassifications.get(workspaceName) ?? 'unknown'
}
