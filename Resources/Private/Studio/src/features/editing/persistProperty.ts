import { type Command, executeCommands } from '@/api/commands'
import { queryKeys } from '@/api/keys'
import { fetchAncestors, fetchNode, type NodeDto } from '@/api/nodes'
import { queryClient } from '@/app/queryClient'

/**
 * The shared write path for node edits (properties and references). Mirrors
 * the classic UI's semantics for shine-through nodes (origin dimension !=
 * viewed dimension): transparently create the variant at the viewed dimension
 * first - varying the closest non-tethered ancestor if the edited node is
 * tethered - so the edit never writes through to the other variant.
 */
async function withVariantHandling(
  address: string,
  buildCommand: (node: NodeDto, origin: Record<string, string>) => Command,
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

  // After a transparent variant creation the viewed dimension is occupied.
  commands.push(
    buildCommand(
      node,
      isShineThrough
        ? node.dimensionSpacePoint
        : node.originDimensionSpacePoint,
    ),
  )

  await executeCommands(commands)

  if (isShineThrough) {
    // A new variant changes coverage everywhere - drop all node reads.
    await queryClient.invalidateQueries({ queryKey: queryKeys.nodes.all })
  } else {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.nodes.node(address),
    })
  }
  // Refresh the pending-changes badges.
  void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all })
}

/** Persists a property edit (inline or from the inspector). */
export async function persistPropertyChange(
  address: string,
  property: string,
  value: unknown,
): Promise<void> {
  await withVariantHandling(address, (node, origin) => ({
    type: 'SetNodeProperties',
    payload: {
      workspaceName: node.workspace,
      nodeAggregateId: node.aggregateId,
      originDimensionSpacePoint: origin,
      propertyValues: { [property]: value },
    },
  }))
}

/**
 * Persists a reference edit (reference/references-typed "properties"). The
 * reference name is the property name; the given targets replace the
 * previously set ones - an empty list clears the reference (the CR's
 * "writing no references deletes the previous ones" semantics).
 */
export async function persistReferenceChange(
  address: string,
  referenceName: string,
  targets: string[],
): Promise<void> {
  await withVariantHandling(address, (node, origin) => ({
    type: 'SetNodeReferences',
    payload: {
      workspaceName: node.workspace,
      sourceNodeAggregateId: node.aggregateId,
      sourceOriginDimensionSpacePoint: origin,
      references: [{ referenceName, targets }],
    },
  }))
}
