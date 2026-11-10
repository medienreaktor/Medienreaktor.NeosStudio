import { isConflict } from '@/api/http/errors'
import {
  createNodeVariant,
  setNodeProperties,
  setNodeReferences,
} from '@/api/neos/endpoints/nodeCommands'
import { fetchAncestors, fetchNode, getNode } from '@/api/neos/endpoints/nodes'
import { fetchNodeType } from '@/api/neos/endpoints/nodeTypes'
import { neosKeys } from '@/api/neos/keys'
import {
  type Node,
  type NodeAddress,
  nodeAddressKey,
  nodeTypeConfiguration,
} from '@/api/neos/schema'
import { emitStudioEvent } from '@/app/events'
import { queryClient } from '@/app/queryClient'
import { validateValue } from '@/features/inspector/validators'
import { invalidateAfterContentEdit } from '@/features/workspaces/invalidate'

/**
 * An edit refused before it was sent: the value fails the property's
 * configured validation. The message lists the validators' errors.
 */
export class PropertyValidationError extends Error {
  constructor(
    readonly property: string,
    readonly errors: string[],
  ) {
    super(errors.join(' '))
    this.name = 'PropertyValidationError'
  }
}

/**
 * Validates an edit against the property's (or reference's) validation
 * configuration, read from the node type - every write path runs through
 * here, inline editing as well as the inspector. Both the node and its type
 * are usually cached already (the node is selected, its type inspected);
 * they are only read when not.
 */
async function validateEdit(
  address: NodeAddress,
  name: string,
  value: unknown,
): Promise<void> {
  const node = await queryClient.ensureQueryData({
    queryKey: neosKeys.nodes.get(address),
    queryFn: () => getNode(address, { include: 'hasChildren' }),
  })
  const nodeType = await fetchNodeType(
    address.contentRepositoryId,
    node.nodeType,
  )
  const configuration = nodeTypeConfiguration(nodeType)
  const validation =
    configuration.properties?.[name]?.validation ??
    configuration.references?.[name]?.validation
  const errors = validateValue(value, validation)
  if (errors.length > 0) throw new PropertyValidationError(name, errors)
}

/**
 * Materializes a shine-through node in its viewed dimension, outermost-first:
 * wrapping nodes must exist in the dimension before the nodes inside them, so
 * every shine-through regular ancestor (the document, then containers - their
 * tethered collections vary along automatically) is varied top-down before
 * the node itself. Neos.Api only varies the ancestors missing in the
 * dimension, not the ones shining through, hence the walk here. A tethered
 * node with nothing else shining through is varied as it is - the server
 * varies its nearest non-tethered ancestor with it. Resolves with whether
 * anything was varied - false when the node already originates in the viewed
 * dimension.
 */
async function varyShineThrough(node: Node): Promise<boolean> {
  if (!node.isShineThrough) return false
  const chain = [...(await fetchAncestors(node))].reverse()
  chain.push(node)
  const regular = chain.filter(
    (n) => n.classification === 'regular' && n.isShineThrough,
  )
  const nodesToVary = regular.length > 0 ? regular : [node]
  // One after the other: each variant needs its parent's in place.
  for (const n of nodesToVary) {
    await createNodeVariant(n, n.dimensionSpacePoint)
  }
  return true
}

/**
 * The shared write path for node edits (properties and references). The
 * write goes out directly; only its documented 409 - the node shines through
 * from another dimension - makes it create the variants at the viewed
 * dimension first, wrapping ancestors before the edited node (see
 * varyShineThrough), and retry, so the edit never writes through to the
 * other variant.
 */
async function withVariantHandling<T>(
  address: NodeAddress,
  write: () => Promise<T>,
): Promise<T> {
  let result: T
  try {
    result = await write()
  } catch (error) {
    if (!isConflict(error)) throw error
    const node = await getNode(address)
    if (!node.isShineThrough) throw error
    try {
      await varyShineThrough(node)
      return await write()
    } finally {
      // Also after a failure halfway: some variants may exist by now.
      await invalidateAfterVariation(address)
    }
  }
  // Refresh the pending-changes badges - right away, the editor expects the
  // dirty marker of a first edit at once. Naming the node lets repeated edits
  // of an already changed node skip the full pending-changes refetch.
  void invalidateAfterContentEdit(
    address.contentRepositoryId,
    address.workspaceName,
    [address],
  )
  return result
}

/**
 * Explicitly materializes a shine-through node in the viewed dimension (the
 * preview's "Create variant" button), wrapping ancestors first - the same
 * variant creation an edit would run implicitly, just without an edit.
 * No-op when the node already originates in the viewed dimension.
 */
export async function createVariant(address: NodeAddress): Promise<void> {
  const node = await fetchNode(address)
  let varied: boolean
  try {
    varied = await varyShineThrough(node)
  } catch (error) {
    // Some variants may exist by now.
    await invalidateAfterVariation(address)
    throw error
  }
  if (varied) await invalidateAfterVariation(address)
}

async function invalidateAfterVariation(address: NodeAddress): Promise<void> {
  // A new variant changes coverage throughout the workspace - drop its node
  // reads.
  await queryClient.invalidateQueries({
    queryKey: neosKeys.nodes.workspace(
      address.contentRepositoryId,
      address.workspaceName,
    ),
  })
  // Refresh the pending-changes badges.
  void invalidateAfterContentEdit(
    address.contentRepositoryId,
    address.workspaceName,
  )
}

/**
 * Puts the node a write answered with into the cached reads of the node
 * itself (the get keys, whatever their filter) - no refetch needed. What the
 * reads included beyond it (hasChildren) is kept.
 */
function cacheNode(address: NodeAddress, node: Node): void {
  queryClient.setQueriesData<Node>(
    {
      queryKey: neosKeys.nodes.node(address),
      predicate: (query) =>
        query.queryKey.length === neosKeys.nodes.get(address).length &&
        typeof query.queryKey[query.queryKey.length - 1] === 'object',
    },
    (cached) => (cached ? { ...cached, ...node } : cached),
  )
}

/** Persists a property edit (inline or from the inspector). */
export async function persistPropertyChange(
  address: NodeAddress,
  property: string,
  value: unknown,
): Promise<void> {
  await validateEdit(address, property, value)
  const node = await withVariantHandling(address, () =>
    setNodeProperties(address, { [property]: value }),
  )
  cacheNode(address, node)
  emitStudioEvent('node.edited', { address, kind: 'property', name: property })
}

// Serialization state of the queued variant below, keyed per property.
const queuedValues = new Map<string, unknown>()
const runningChains = new Map<string, Promise<void>>()

async function runPersistChain(
  key: string,
  address: NodeAddress,
  property: string,
): Promise<void> {
  try {
    while (queuedValues.has(key)) {
      const value = queuedValues.get(key)
      queuedValues.delete(key)
      await persistPropertyChange(address, property, value)
    }
  } catch (error) {
    // Don't replay values queued behind a failure - they would race the
    // user's next attempt; the caller surfaces the error.
    queuedValues.delete(key)
    throw error
  } finally {
    runningChains.delete(key)
  }
}

/**
 * persistPropertyChange for rapid-fire sources (the debounced inline commits
 * while typing): saves of the same property never overlap - while one request
 * runs, newer values coalesce into a single follow-up save carrying only the
 * latest state (the same discipline the classic UI's changes saga applies).
 */
export function persistPropertyChangeQueued(
  address: NodeAddress,
  property: string,
  value: unknown,
): Promise<void> {
  const key = `${nodeAddressKey(address)}\0${property}`
  queuedValues.set(key, value)
  let chain = runningChains.get(key)
  if (!chain) {
    chain = runPersistChain(key, address, property)
    runningChains.set(key, chain)
  }
  return chain
}

/**
 * Persists a reference edit (reference/references-typed "properties"). The
 * reference name is the property name; the given targets replace the
 * previously set ones - an empty list clears the reference (the CR's
 * "writing no references deletes the previous ones" semantics).
 */
export async function persistReferenceChange(
  address: NodeAddress,
  referenceName: string,
  targets: string[],
): Promise<void> {
  await validateEdit(
    address,
    referenceName,
    // The reference editors' value: one id, or the list of them.
    targets.length === 0 ? null : targets,
  )
  await withVariantHandling(address, () =>
    setNodeReferences(address, { [referenceName]: targets }),
  )
  emitStudioEvent('node.edited', {
    address,
    kind: 'references',
    name: referenceName,
  })
  await queryClient.invalidateQueries({
    queryKey: neosKeys.nodes.references(address),
  })
}
