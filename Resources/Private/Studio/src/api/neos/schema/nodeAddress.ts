import type { Node, NodeAddress } from './index'

/**
 * Helpers for NodeAddress, the four fields that identify a node. Another
 * address of the same node is a spread away, e.g. the node in another
 * dimension space point: { ...nodeAddressOf(node), dimensionSpacePoint }.
 */

/** Just the address of a node (or address), without the node's other fields. */
export function nodeAddressOf(node: NodeAddress): NodeAddress {
  return {
    contentRepositoryId: node.contentRepositoryId,
    workspaceName: node.workspaceName,
    dimensionSpacePoint: node.dimensionSpacePoint,
    nodeAggregateId: node.nodeAggregateId,
  }
}

export function sameNodeAddress(
  a: NodeAddress | null | undefined,
  b: NodeAddress | null | undefined,
): boolean {
  if (!a || !b) return a === b
  return (
    a.nodeAggregateId === b.nodeAggregateId &&
    a.workspaceName === b.workspaceName &&
    a.dimensionSpacePoint === b.dimensionSpacePoint &&
    a.contentRepositoryId === b.contentRepositoryId
  )
}

/**
 * A string for the address, where one is needed to tell nodes apart in the
 * shell: Map and Set keys, React keys. Never sent anywhere.
 */
export function nodeAddressKey(address: NodeAddress): string {
  return JSON.stringify([
    address.contentRepositoryId,
    address.workspaceName,
    address.dimensionSpacePoint,
    address.nodeAggregateId,
  ])
}

/** The address a nodeAddressKey() was made of. */
export function nodeAddressFromKey(key: string): NodeAddress {
  const [
    contentRepositoryId,
    workspaceName,
    dimensionSpacePoint,
    nodeAggregateId,
    // nodeAddressKey() always serializes exactly these four strings.
  ] = JSON.parse(key) as [string, string, string, string]
  return {
    contentRepositoryId,
    workspaceName,
    dimensionSpacePoint,
    nodeAggregateId,
  }
}

/**
 * The address of a node in rendered edit-mode markup: Neos core's NodeAddress
 * JSON (data-__neos-node-contextpath), which names the aggregate id
 * "aggregateId" and has the dimension space point as an object.
 */
export function nodeAddressFromContextPath(contextPath: string): NodeAddress {
  const address = JSON.parse(contextPath) as {
    contentRepositoryId: string
    workspaceName: string
    dimensionSpacePoint: Record<string, string>
    aggregateId: string
  }
  return {
    contentRepositoryId: address.contentRepositoryId,
    workspaceName: address.workspaceName,
    dimensionSpacePoint: JSON.stringify(address.dimensionSpacePoint),
    nodeAggregateId: address.aggregateId,
  }
}

/** Whether the node is deleted (soft removed: tagged "removed", itself or by an ancestor). */
export function isRemoved(node: Pick<Node, 'tags' | 'inheritedTags'>): boolean {
  return node.tags.includes('removed') || node.inheritedTags.includes('removed')
}
