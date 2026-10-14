import { config } from '@/config'
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

/** The address of the same node aggregate in another workspace - following a
 * document across an editing-context switch. */
export function addressInWorkspace(
  encoded: string,
  workspaceName: string,
): string {
  return encodeNodeAddress({
    ...decodeNodeAddress(encoded),
    workspaceName,
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

/**
 * Where Neos.Api serves a node: `/cr/{contentRepositoryId}/nodes/{id}` plus
 * the subgraph as query parameters. Neos.Api addresses nodes by these parts
 * instead of one opaque address; the shell keeps its addresses (cache keys,
 * tree item ids, preview links) and translates at the API boundary.
 */
export interface NodeLocation {
  /** `/cr/{contentRepositoryId}/nodes/{nodeAggregateId}` */
  path: string
  /** `/cr/{contentRepositoryId}/nodes` - for listings and creation */
  collectionPath: string
  workspaceName: string
  /** The dimension space point as Neos.Api takes it: a JSON string. */
  dimensionSpacePoint: string
}

export function nodeLocation(encoded: string): NodeLocation {
  const address = decodeNodeAddress(encoded)
  const collectionPath = `/cr/${encodeURIComponent(address.contentRepositoryId)}/nodes`
  return {
    path: `${collectionPath}/${encodeURIComponent(address.aggregateId)}`,
    collectionPath,
    workspaceName: address.workspaceName,
    dimensionSpacePoint: JSON.stringify(address.dimensionSpacePoint),
  }
}

/**
 * The address of a node Neos.Api returned (its dimensionSpacePoint is a JSON
 * string there). Field order matches addressFromContextPath, so the encoding
 * is byte-identical to the addresses the guest markup yields.
 */
export function addressOf(node: {
  contentRepositoryId: string
  workspaceName: string
  dimensionSpacePoint: string | DimensionSpacePoint
  nodeAggregateId: string
}): string {
  return encodeNodeAddress({
    contentRepositoryId: node.contentRepositoryId,
    workspaceName: node.workspaceName,
    dimensionSpacePoint:
      typeof node.dimensionSpacePoint === 'string'
        ? (JSON.parse(node.dimensionSpacePoint) as DimensionSpacePoint)
        : node.dimensionSpacePoint,
    aggregateId: node.nodeAggregateId,
  })
}

/** `/cr/{contentRepositoryId}` of the content repository the Studio edits. */
export function contentRepositoryPath(): string {
  return `/cr/${encodeURIComponent(config.contentRepositoryId)}`
}
