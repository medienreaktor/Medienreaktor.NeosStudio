import {
  fetchAllowedChildNodeTypes,
  fetchAncestors,
  fetchNode,
} from '@/api/neos/endpoints/nodes'
import { type Node, type NodeAddress, nodeAddressOf } from '@/api/neos/schema'

/**
 * The parent for sibling insertion, from the reference's ancestors (closest
 * first): null when that is the root (the sites node) - a sibling of a site
 * would be a new site.
 */
export function insertionParentOf(ancestors: Node[]): NodeAddress | null {
  const [parent] = ancestors
  return parent && parent.classification !== 'root'
    ? nodeAddressOf(parent)
    : null
}

/**
 * Warms the cache entries the insertion dialog reads for this reference
 * node: the node itself (its label), the types allowed inside it, and - via
 * the parent, resolved from the ancestors when the caller doesn't know it -
 * the types allowed next to it. Called where "Create new…" is about to be
 * offered (a context menu opening, the pointer reaching a "+" button), so
 * the dialog usually opens on data that is already there instead of filling
 * in piece by piece.
 *
 * `parentAddress` follows InsertRequest: undefined = unknown (resolved here),
 * null = no siblings possible. Fire-and-forget; failures stay silent - the
 * dialog's own queries retry and surface them.
 */
export function prefetchInsertion(
  referenceAddress: NodeAddress,
  parentAddress?: NodeAddress | null,
): void {
  const ignore = () => {
    /* the dialog's own queries retry and report */
  }
  fetchNode(referenceAddress).catch(ignore)
  fetchAllowedChildNodeTypes(referenceAddress).catch(ignore)
  if (parentAddress === null) return
  const parent =
    parentAddress !== undefined
      ? Promise.resolve(parentAddress)
      : fetchAncestors(referenceAddress).then(insertionParentOf)
  parent
    .then((address) =>
      address ? fetchAllowedChildNodeTypes(address) : undefined,
    )
    .catch(ignore)
}
