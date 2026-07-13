import { type Command, executeCommands } from '@/api/commands'
import { queryKeys } from '@/api/keys'
import { fetchAncestors, fetchNode, type NodeDto } from '@/api/nodes'
import { queryClient } from '@/app/queryClient'

/**
 * Persists a property edit (inline or from the inspector). Mirrors the
 * classic UI's semantics for shine-through nodes (origin dimension != viewed
 * dimension): transparently create the variant at the viewed dimension first
 * - varying the closest non-tethered ancestor if the edited node is tethered
 * - so the edit never writes through to the other variant.
 */
export async function persistPropertyChange(
  address: string,
  property: string,
  value: unknown,
): Promise<void> {
  const node = await fetchNode(address)
  const commands: Command[] = []

  const isShineThrough =
    JSON.stringify(node.dimensionSpacePoint) !==
    JSON.stringify(node.originDimensionSpacePoint)
  if (isShineThrough) {
    let nodeToVary: NodeDto = node
    if (node.classification === 'tethered') {
      const chain = [node, ...(await fetchAncestors(address))]
      const firstUntethered = chain.findIndex(
        (n) => n.classification !== 'tethered',
      )
      let candidate = chain[firstUntethered] ?? node
      // Root nodes cannot vary, but their tethered children can.
      if (candidate.classification === 'root' && firstUntethered > 0) {
        candidate = chain[firstUntethered - 1] ?? node
      }
      nodeToVary = candidate
    }
    commands.push({
      type: 'CreateNodeVariant',
      payload: {
        workspaceName: nodeToVary.workspace,
        nodeAggregateId: nodeToVary.aggregateId,
        sourceOrigin: nodeToVary.originDimensionSpacePoint,
        targetOrigin: node.dimensionSpacePoint,
      },
    })
  }

  commands.push({
    type: 'SetNodeProperties',
    payload: {
      workspaceName: node.workspace,
      nodeAggregateId: node.aggregateId,
      // After a transparent variant creation the viewed dimension is occupied.
      originDimensionSpacePoint: isShineThrough
        ? node.dimensionSpacePoint
        : node.originDimensionSpacePoint,
      propertyValues: { [property]: value },
    },
  })

  await executeCommands(commands)

  if (isShineThrough) {
    // A new variant changes coverage everywhere - drop all node reads.
    await queryClient.invalidateQueries({ queryKey: queryKeys.nodes.all })
  } else {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.nodes.byAddress(address),
    })
  }
  // Refresh the pending-changes badges.
  void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all })
}
