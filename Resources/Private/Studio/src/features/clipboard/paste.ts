import { copyNode, runSequentially } from '@/api/commands'
import { queryKeys } from '@/api/keys'
import { fetchChildren } from '@/api/nodes'
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
  newAddress: string
  /** Addresses whose children lists changed - refresh them. */
  affectedAddresses: string[]
}

/**
 * Paste the entry's nodes as children of parentAddress, before
 * succeedingSibling (null appends). A successfully pasted cut entry is
 * consumed - the nodes have moved, pasting again would just move them once
 * more.
 */
export async function pasteClipboardEntry(
  entry: ClipboardEntry,
  parentAddress: string,
  succeedingSiblingAddress: string | null,
): Promise<PasteResult> {
  if (entry.mode === 'cut') {
    await moveNodesByAddress(
      entry.nodes.map((node) => ({
        nodeAddress: node.address,
        newParentAddress: parentAddress,
        succeedingSiblingAddress,
      })),
    )
    clipboardRemove(entry.id)
    const sourceParents = entry.nodes
      .map((node) => node.sourceParentAddress)
      .filter((address): address is string => address !== null)
    return {
      newAddress: entry.nodes[0].address,
      affectedAddresses: [...new Set([parentAddress, ...sourceParents])],
    }
  }

  const newAddresses = await copyNodes(
    entry.nodes.map((node) => node.address),
    parentAddress,
    succeedingSiblingAddress,
  )
  return { newAddress: newAddresses[0], affectedAddresses: [parentAddress] }
}

/**
 * Recursively copy nodes, one after the other, and return the copies'
 * addresses. All copies go before the same succeeding sibling, so they land
 * in source order; each copy originates in the target parent's (viewed)
 * dimension space point.
 */
async function copyNodes(
  sourceAddresses: string[],
  targetParentAddress: string,
  targetSucceedingSiblingAddress: string | null,
): Promise<string[]> {
  try {
    const copies = await runSequentially(sourceAddresses, (sourceAddress) =>
      copyNode(
        sourceAddress,
        targetParentAddress,
        targetSucceedingSiblingAddress,
      ),
    )
    return copies.map((copy) => copy.address)
  } finally {
    // The target's children changed - drop all node reads (children lists
    // are keyed under nodes) and refresh the pending-changes badges.
    await queryClient.invalidateQueries({ queryKey: queryKeys.nodes.all })
    void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all })
  }
}

/**
 * The succeeding sibling for a "paste after reference" insertion: the
 * reference's next sibling among the parent's unfiltered children (null
 * appends), so nodes of other roles between two siblings don't shift the
 * insertion point - same resolution as the insert dialog's "after" mode.
 */
export async function resolveSucceedingSibling(
  referenceAddress: string,
  parentAddress: string,
): Promise<string | null> {
  const siblings = await fetchChildren(parentAddress)
  const index = siblings.findIndex((node) => node.address === referenceAddress)
  return index >= 0 ? (siblings[index + 1]?.address ?? null) : null
}
