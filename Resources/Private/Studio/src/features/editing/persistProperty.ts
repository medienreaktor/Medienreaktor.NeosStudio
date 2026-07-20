import { type Command, executeCommands } from '@/api/commands'
import { queryKeys } from '@/api/keys'
import {
  fetchAncestors,
  fetchNode,
  isShineThrough,
  type NodeDto,
} from '@/api/nodes'
import { queryClient } from '@/app/queryClient'

/**
 * The CreateNodeVariant commands that materialize a shine-through node in
 * its viewed dimension, outermost-first: wrapping nodes must exist in the
 * dimension before the nodes inside them, so every shine-through regular
 * ancestor (the document, then containers - their tethered collections vary
 * along automatically) is varied top-down before the node itself. Tethered
 * nodes are skipped - the content repository varies them together with
 * their parent - except when the node hangs tethered directly below a root
 * (roots cannot vary, but their tethered children can). Empty when the node
 * already originates in the viewed dimension.
 */
async function variantCommands(node: NodeDto): Promise<Command[]> {
  if (!isShineThrough(node)) return []
  const chain = [...(await fetchAncestors(node.address))].reverse()
  chain.push(node)
  let nodesToVary = chain.filter(
    (n) => n.classification === 'regular' && isShineThrough(n),
  )
  if (nodesToVary.length === 0) {
    const outermostTethered = chain.find((n) => n.classification === 'tethered')
    nodesToVary = outermostTethered ? [outermostTethered] : []
  }
  return nodesToVary.map((n) => ({
    type: 'CreateNodeVariant',
    payload: {
      workspaceName: n.workspace,
      nodeAggregateId: n.aggregateId,
      sourceOrigin: n.originDimensionSpacePoint,
      targetOrigin: n.dimensionSpacePoint,
    },
  }))
}

/**
 * The shared write path for node edits (properties and references). For
 * shine-through nodes (origin dimension != viewed dimension) it transparently
 * creates the variants at the viewed dimension first, wrapping ancestors
 * before the edited node (see variantCommands), so the edit never writes
 * through to the other variant.
 */
async function withVariantHandling(
  address: string,
  buildCommand: (node: NodeDto, origin: Record<string, string>) => Command,
): Promise<void> {
  const node = await fetchNode(address)
  const variants = await variantCommands(node)
  const commands: Command[] = [...variants]

  // After a transparent variant creation the viewed dimension is occupied.
  commands.push(
    buildCommand(
      node,
      variants.length > 0
        ? node.dimensionSpacePoint
        : node.originDimensionSpacePoint,
    ),
  )

  await executeCommands(commands)

  if (variants.length > 0) {
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

/**
 * Explicitly materializes a shine-through node in the viewed dimension (the
 * preview's "Create variant" button), wrapping ancestors first - the same
 * variant creation an edit would run implicitly, just without an edit.
 * No-op when the node already originates in the viewed dimension.
 */
export async function createVariant(address: string): Promise<void> {
  const node = await fetchNode(address)
  const commands = await variantCommands(node)
  if (commands.length === 0) return
  await executeCommands(commands)
  // A new variant changes coverage everywhere - drop all node reads.
  await queryClient.invalidateQueries({ queryKey: queryKeys.nodes.all })
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
