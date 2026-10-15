import { copyNode, runSequentially } from '@/api/neos/endpoints/nodeCommands'
import { fetchChildren } from '@/api/neos/endpoints/nodes'
import { neosKeys } from '@/api/neos/keys'
import {
  type NodeAddress,
  nodeAddressOf,
  nodeAddressKey,
} from '@/api/neos/schema'
import { queryClient } from '@/app/queryClient'
import { moveNodesByAddress } from '@/features/editing/nodeActions'
import { type ClipboardEntry, clipboardRemove } from './clipboardStore'

/**
 * Pasting the clipboard: a cut entry moves its nodes (same as tree
 * drag-and-drop), a copied entry duplicates them recursively (the server runs
 * Neos' NodeDuplicationService - Neos 9 has no CR copy command). A group
 * entry (multi-selection capture) is pasted node by node: each inserted
 * before the same succeeding sibling, in order, so the group keeps its
 * relative order at the target.
 */

export interface PasteResult {
  /** Address of the first pasted node (the copy, or the moved node itself). */
  newAddress: NodeAddress
  /** Addresses whose children lists changed - refresh them. */
  affectedAddresses: NodeAddress[]
}

/**
 * Paste the entry's nodes as children of parentAddress, before
 * succeedingSibling (null appends). A successfully pasted cut entry is
 * consumed - the nodes have moved, pasting again would just move them once
 * more.
 */
export async function pasteClipboardEntry(
  entry: ClipboardEntry,
  parentAddress: NodeAddress,
  succeedingSiblingAddress: NodeAddress | null,
): Promise<PasteResult> {
  // Entries are never empty (see ClipboardEntry.nodes); a broken one must not
  // turn into a paste that reports no node.
  const [firstNode] = entry.nodes
  if (!firstNode) throw new Error('Cannot paste an empty clipboard entry.')

  if (entry.mode === 'cut') {
    // Like a copy, a move happens where it is pasted: in the target's
    // workspace and dimension space point, whichever the node was cut in.
    const inTarget = (address: NodeAddress): NodeAddress => ({
      ...address,
      workspaceName: parentAddress.workspaceName,
      dimensionSpacePoint: parentAddress.dimensionSpacePoint,
    })
    await moveNodesByAddress(
      entry.nodes.map((node) => ({
        nodeAddress: inTarget(node.address),
        newParentAddress: parentAddress,
        succeedingSiblingAddress,
      })),
    )
    clipboardRemove(entry.id)
    const sourceParents = entry.nodes
      .map((node) => node.sourceParentAddress)
      .filter((address): address is NodeAddress => address !== null)
      .map(inTarget)
    return {
      newAddress: inTarget(firstNode.address),
      affectedAddresses: uniqueAddresses([parentAddress, ...sourceParents]),
    }
  }

  const newAddresses = await copyNodes(
    entry.nodes.map((node) => node.address),
    parentAddress,
    succeedingSiblingAddress,
  )
  return {
    // copyNodes() returns one copy per input node, and there is at least one.
    newAddress: newAddresses[0]!,
    affectedAddresses: [parentAddress],
  }
}

/**
 * Recursively copy nodes, one after the other, and return the copies'
 * addresses. All copies go before the same succeeding sibling, so they land
 * in source order; each copy originates in the target parent's (viewed)
 * dimension space point.
 */
async function copyNodes(
  sourceAddresses: NodeAddress[],
  targetParentAddress: NodeAddress,
  targetSucceedingSiblingAddress: NodeAddress | null,
): Promise<NodeAddress[]> {
  try {
    const copies = await runSequentially(sourceAddresses, (sourceAddress) =>
      copyNode(
        sourceAddress,
        targetParentAddress,
        targetSucceedingSiblingAddress?.nodeAggregateId ?? null,
      ),
    )
    return copies.map(nodeAddressOf)
  } finally {
    // The target's children changed - drop all node reads (children lists
    // are keyed under nodes) and refresh the pending-changes badges.
    await queryClient.invalidateQueries({ queryKey: neosKeys.nodes.all })
    void queryClient.invalidateQueries({ queryKey: neosKeys.workspaces.all })
  }
}

/** The addresses without duplicates, in order. */
function uniqueAddresses(addresses: NodeAddress[]): NodeAddress[] {
  const byKey = new Map<string, NodeAddress>()
  for (const address of addresses) {
    const key = nodeAddressKey(address)
    if (!byKey.has(key)) byKey.set(key, address)
  }
  return [...byKey.values()]
}

/**
 * The succeeding sibling for a "paste after reference" insertion: the
 * reference's next sibling among the parent's unfiltered children (null
 * appends), so nodes of other roles between two siblings don't shift the
 * insertion point - same resolution as the insert dialog's "after" mode.
 */
export async function resolveSucceedingSibling(
  referenceAddress: NodeAddress,
  parentAddress: NodeAddress,
): Promise<NodeAddress | null> {
  const siblings = await fetchChildren(parentAddress)
  // The siblings are one subgraph - the aggregate id tells them apart.
  const index = siblings.findIndex(
    (node) => node.nodeAggregateId === referenceAddress.nodeAggregateId,
  )
  const next = index >= 0 ? siblings[index + 1] : undefined
  return next ? nodeAddressOf(next) : null
}
