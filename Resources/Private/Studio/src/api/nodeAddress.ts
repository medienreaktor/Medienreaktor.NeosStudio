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

/** The address of the same node aggregate in another dimension space point. */
export function addressInDimension(encoded: string, dimensionSpacePoint: DimensionSpacePoint): string {
  return encodeNodeAddress({ ...decodeNodeAddress(encoded), dimensionSpacePoint })
}
