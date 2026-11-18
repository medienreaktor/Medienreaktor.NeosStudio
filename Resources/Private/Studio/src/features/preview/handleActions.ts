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
 * The node behind a handle and the handle actions offered on it. The node is
 * read through the query cache, so moving the handle back and forth costs no
 * further requests; the registry is read after it arrived.
 */
async function offeredOn(address: NodeAddress, studio: StudioActions) {
  const node = await fetchNode(address)
  const context: NodeActionContext = {
    surface: 'preview',
    selection: [node],
    studio,
  }
  const actions = offeredHandleActions(
    nodeActionRegistry.getAll(),
    node,
    context,
  )
  return { node, context, actions }
}

/**
 * The node actions offered as buttons on the handle of this node's element,
 * ready for the guest. A node that cannot be read gets no buttons.
 */
export async function handleActionsFor(
  address: NodeAddress,
  studio: StudioActions,
): Promise<HandleAction[]> {
  let offered
  try {
    offered = await offeredOn(address, studio)
  } catch {
    return []
  }
  return Promise.all(
    offered.actions.map(async (action) => ({
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
  let offered
  try {
    offered = await offeredOn(address, studio)
  } catch (error) {
    toast.error(error)
    return
  }
  const { node, context, actions } = offered
  const action = actions.find((candidate) => candidate.id === actionId)
  if (!action) return
  // The button gives no feedback of its own, so a slow run announces
  // itself with a loading toast, as from a menu.
  runAction(action, busyKey(action.id, node), () => action.run(node, context), {
    announce: true,
  })
}
