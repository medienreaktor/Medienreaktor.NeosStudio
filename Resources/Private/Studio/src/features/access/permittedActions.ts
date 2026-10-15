import type { Node } from '@/api/neos/schema'
import { documentAccessState, nodePermits } from './useAccess'

/** What may be done to one node, per context-menu action. */
export interface PermittedActions {
  create: boolean
  edit: boolean
  delete: boolean
  move: boolean
}

/**
 * The per-action verdict for a tree row, in the shape the context menu takes.
 *
 * Two layers, and both matter. A node the role does not cover at all is closed
 * to everything - it is only in the tree as the path to something else. A node
 * it does cover is then subject to the role's capabilities, action by action:
 * "may edit but not delete" is an ordinary thing for a role to say, and it
 * should read as a greyed-out Delete rather than as an error after the click.
 * While the access is still unknown, nothing is permitted (see useAccess.ts).
 */
export function permittedActionsOn(
  node: Node,
  siteNodeName?: string,
): PermittedActions {
  if (documentAccessState(node, siteNodeName) !== 'allowed') {
    return { create: false, edit: false, delete: false, move: false }
  }

  return {
    create: nodePermits(node, 'createNodes'),
    edit: nodePermits(node, 'editNodes'),
    delete: nodePermits(node, 'deleteNodes'),
    move: nodePermits(node, 'moveNodes'),
  }
}
