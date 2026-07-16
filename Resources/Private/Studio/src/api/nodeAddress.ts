import type { DimensionSpacePoint } from './dimensions'

/**
 * A node address is base64url-encoded JSON of the complete node identity.
 * Decoding lets the client derive sibling identities - most importantly the
 * same node in another dimension space point.
 */
export interface NodeAddress {
  contentRepositoryId: string
  workspaceName: string
  dimensionSpacePoint: DimensionSpacePoint
  aggregateId: string
}

export function decodeNodeAddress(encoded: string): NodeAddress {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  return JSON.parse(new TextDecoder().decode(bytes)) as NodeAddress
}

export function encodeNodeAddress(address: NodeAddress): string {
  const bytes = new TextEncoder().encode(JSON.stringify(address))
  const base64 = btoa(String.fromCharCode(...bytes))
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Studio address for a NodeAddress JSON string as emitted into edit-mode
 * markup (data-__neos-node-contextpath). The explicit literal re-establishes
 * the backend's field order, so the encoding is byte-identical to the
 * addresses the API returns (they serve as cache keys and tree item ids).
 */
export function addressFromContextPath(contextPath: string): string {
  const raw = JSON.parse(contextPath) as NodeAddress
  return encodeNodeAddress({
    contentRepositoryId: raw.contentRepositoryId,
    workspaceName: raw.workspaceName,
    dimensionSpacePoint: raw.dimensionSpacePoint,
    aggregateId: raw.aggregateId,
  })
}

/** The address of the same node aggregate in another dimension space point. */
export function addressInDimension(
  encoded: string,
  dimensionSpacePoint: DimensionSpacePoint,
): string {
  return encodeNodeAddress({
    ...decodeNodeAddress(encoded),
    dimensionSpacePoint,
  })
}

/**
 * The address of a different node aggregate in the same subgraph (workspace and
 * dimension space point) as the given one. Used to resolve a persisted node id
 * against the current site's context after a reload.
 */
export function addressWithAggregateId(
  encoded: string,
  aggregateId: string,
): string {
  return encodeNodeAddress({
    ...decodeNodeAddress(encoded),
    aggregateId,
  })
}

/** The aggregate id encoded in a node address. */
export function aggregateIdOf(encoded: string): string {
  return decodeNodeAddress(encoded).aggregateId
}
