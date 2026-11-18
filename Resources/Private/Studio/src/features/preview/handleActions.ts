import { fetchNode } from '@/api/neos/endpoints/nodes'
import type { NodeAddress } from '@/api/neos/schema'
import type { StudioActions } from '@/app/StudioContext'
import { toast } from '@/components/ui/toast'
import { iconImage } from '@/features/actions/iconImage'
import {
  busyKey,
  type NodeActionContext,
  nodeActionRegistry,
  offeredHandleActions,
  runAction,
} from '@/features/actions/registry'
import { labelOf } from '@/lib/registry'
import type { HandleAction } from './protocol'

/**
 * The node actions offered as buttons on the handle of this node's element,
 * ready for the guest. The node is read through the query cache, so moving
 * the handle back and forth costs no further requests; a node that cannot be
 * read gets no buttons.
 */
export async function handleActionsFor(
  address: NodeAddress,
  studio: StudioActions,
): Promise<HandleAction[]> {
  const candidates = nodeActionRegistry.getAll()
  let node
  try {
    node = await fetchNode(address)
  } catch {
    return []
  }
  const context: NodeActionContext = {
    surface: 'preview',
    selection: [node],
    studio,
  }
  return Promise.all(
    offeredHandleActions(candidates, node, context).map(async (action) => ({
      id: action.id,
      label: labelOf(action.label),
      icon: action.icon ? await iconImage(action.icon) : null,
    })),
  )
}

/**
 * Run a handle button's action on the node - if it is still registered and
 * offered there: the guest's buttons can be a registry change behind.
 */
export async function runHandleAction(
  actionId: string,
  address: NodeAddress,
  studio: StudioActions,
): Promise<void> {
  let node
  try {
    node = await fetchNode(address)
  } catch (error) {
    toast.error(error)
    return
  }
  const context: NodeActionContext = {
    surface: 'preview',
    selection: [node],
    studio,
  }
  const action = offeredHandleActions(
    nodeActionRegistry.getAll(),
    node,
    context,
  ).find((candidate) => candidate.id === actionId)
  if (!action) return
  // The button gives no feedback of its own, so a slow run announces
  // itself with a loading toast, as from a menu.
  runAction(action, busyKey(action.id, node), () => action.run(node, context), {
    announce: true,
  })
}
