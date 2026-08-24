import { useEffect } from 'react'

import {
  nodeAccessState,
  useMyAccess,
  type EffectiveAccess,
} from '@/api/accessRoles'
import { observedIdPath, useNodeAncestors, type NodeDto } from '@/api/nodes'

/**
 * The acting user's effective access, plus the module-level snapshot the
 * synchronous consumers need.
 *
 * Node decorators are pure `(node) => decoration` functions called during
 * render for every visible row - they have no place to call a hook and no
 * props to receive access through. So the hook mirrors the query result into
 * a module snapshot, and those consumers read it from there. It is a cache of
 * one value that changes at most once per session, not shared mutable state
 * doing real work.
 */

let snapshot: EffectiveAccess | undefined
let activeSiteNodeName = ''

/**
 * Subscribe to the own effective access. Safe to call from anywhere - the
 * query is deduplicated, so extra callers cost nothing.
 */
export function useAccess(enabled = true): EffectiveAccess | undefined {
  const { data } = useMyAccess(enabled)

  useEffect(() => {
    snapshot = data?.access
  }, [data])

  return data?.access
}

/**
 * Tell the synchronous consumers which site the shell is showing. Called once
 * by the App: site restrictions are per site, and a decorator looking at a
 * bare node has no way to tell which one it belongs to.
 */
export function useActiveSiteForAccess(siteNodeName: string | null): void {
  useEffect(() => {
    activeSiteNodeName = siteNodeName ?? ''
  }, [siteNodeName])
}

/**
 * The last known effective access, for synchronous consumers. Returns
 * undefined until /access/me has resolved - which every helper treats as
 * "unrestricted", so the UI never flashes a locked state it then takes back.
 */
export function currentAccess(): EffectiveAccess | undefined {
  return snapshot
}

/**
 * How a document should be treated in the trees, from the ancestry observed
 * while loading them. Documents reached without their ancestry known resolve
 * against a short path, which can only ever fail *open* (fewer ancestors =
 * fewer rules match = no rule matched = the tree stays visible) - and the
 * server still refuses the write.
 */
export function documentAccessState(
  node: NodeDto,
  siteNodeName: string = activeSiteNodeName,
  access: EffectiveAccess | undefined = snapshot,
): 'allowed' | 'restricted' | 'hidden' {
  return nodeAccessState(access, observedIdPath(node.aggregateId), siteNodeName)
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
 * Fails closed while that chain is in flight: for a restricted account the
 * brief lock resolves into an unlocked editor, whereas the other way round
 * hands out an editor whose save the server would refuse.
 */
export function useNodeEditable(node: NodeDto | null): boolean {
  const access = useAccess()
  const restricted = access !== undefined && !access.unrestricted
  const { data: ancestors, isPending } = useNodeAncestors(
    restricted && node !== null ? node.address : null,
  )

  if (node === null || !restricted) return true
  // isPending covers "not fetched yet"; a failed fetch resolves to no
  // ancestors, which the rules below then evaluate against the node alone.
  if (isPending) return false

  const idPath = [
    node.aggregateId,
    ...(ancestors ?? []).map((ancestor) => ancestor.aggregateId),
  ]

  return nodeAccessState(access, idPath, activeSiteNodeName) === 'allowed'
}
