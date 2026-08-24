import { useEffect } from 'react'

import {
  nodeAccessState,
  useMyAccess,
  type EffectiveAccess,
} from '@/api/accessRoles'
import { observedIdPath, type NodeDto } from '@/api/nodes'

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
