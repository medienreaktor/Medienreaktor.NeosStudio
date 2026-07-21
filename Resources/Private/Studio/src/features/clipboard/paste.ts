import { executeCommands } from '@/api/commands'
import { queryKeys } from '@/api/keys'
import { addressWithAggregateId, decodeNodeAddress } from '@/api/nodeAddress'
import { fetchChildren } from '@/api/nodes'
import { queryClient } from '@/app/queryClient'
import { moveNodesByAddress } from '@/features/editing/nodeActions'
import { type ClipboardEntry, clipboardRemove } from './clipboardStore'

/**
 * Pasting the clipboard: a cut entry moves the node (MoveNodeAggregate, same
 * as tree drag-and-drop), a copied entry duplicates it recursively via the
 * synthetic CopyNodesRecursively command - same /commands envelope as every
 * other write; the backend dispatches it to the NodeDuplicationService since
 * Neos 9 has no CR copy command.
 */

export interface PasteResult {
  /** Address of the pasted node (the copy, or the moved node itself). */
  newAddress: string
  /** Addresses whose children lists changed - refresh them. */
  affectedAddresses: string[]
}

/**
 * Paste the entry as a child of parentAddress, before succeedingSibling
 * (null appends). A successfully pasted cut entry is consumed - the node has
 * moved, pasting it again would just move it once more.
 */
export async function pasteClipboardEntry(
  entry: ClipboardEntry,
  parentAddress: string,
  succeedingSiblingAddress: string | null,
): Promise<PasteResult> {
  if (entry.mode === 'cut') {
    await moveNodesByAddress([
      {
        nodeAddress: entry.address,
        newParentAddress: parentAddress,
        succeedingSiblingAddress,
      },
    ])
    clipboardRemove(entry.id)
    return {
      newAddress: entry.address,
      affectedAddresses: entry.sourceParentAddress
        ? [parentAddress, entry.sourceParentAddress]
        : [parentAddress],
    }
  }

  const newAddress = await copyNode(
    entry.address,
    parentAddress,
    succeedingSiblingAddress,
  )
  return { newAddress, affectedAddresses: [parentAddress] }
}

/**
 * Recursively copy a node via the synthetic CopyNodesRecursively command and
 * return the copy's address. Like createNode, the copy root's aggregate id
 * is generated client-side (pinned through nodeAggregateIdMapping), so the
 * address is known without a response field.
 */
async function copyNode(
  sourceAddress: string,
  targetParentAddress: string,
  targetSucceedingSiblingAddress: string | null,
): Promise<string> {
  const source = decodeNodeAddress(sourceAddress)
  const targetParent = decodeNodeAddress(targetParentAddress)
  const newNodeAggregateId = crypto.randomUUID()
  await executeCommands([
    {
      type: 'CopyNodesRecursively',
      payload: {
        workspaceName: targetParent.workspaceName,
        sourceDimensionSpacePoint: source.dimensionSpacePoint,
        sourceNodeAggregateId: source.aggregateId,
        // The copy materializes in the viewed (target) dimension.
        targetDimensionSpacePoint: targetParent.dimensionSpacePoint,
        targetParentNodeAggregateId: targetParent.aggregateId,
        targetSucceedingSiblingNodeAggregateId:
          targetSucceedingSiblingAddress !== null
            ? decodeNodeAddress(targetSucceedingSiblingAddress).aggregateId
            : null,
        nodeAggregateIdMapping: { [source.aggregateId]: newNodeAggregateId },
      },
    },
  ])
  // The target's children changed - drop all node reads (children lists are
  // keyed under nodes) and refresh the pending-changes badges.
  await queryClient.invalidateQueries({ queryKey: queryKeys.nodes.all })
  void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all })
  return addressWithAggregateId(targetParentAddress, newNodeAggregateId)
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
