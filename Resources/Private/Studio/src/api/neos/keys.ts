import type { NodeAddress } from './schema'

/**
 * Query keys of everything read from Neos.Api. Keys are hierarchical so
 * invalidation can be as broad or as narrow as a write's effects require, e.g.
 *
 *   queryClient.invalidateQueries({ queryKey: neosKeys.nodes.all })
 *   queryClient.invalidateQueries({ queryKey: neosKeys.nodes.node(address) })
 *
 * Every Neos.Api query takes its key from here - never inline key literals in
 * hooks, or invalidation silently misses them. The Studio's own endpoints
 * have theirs in api/studio/keys.ts.
 */

/**
 * The address as key parts, outermost first, so a prefix covers a subgraph.
 * null stands for "no node yet": a disabled query still builds its key.
 */
function nodeKey(address: NodeAddress | null) {
  return [
    address?.contentRepositoryId ?? '',
    address?.workspaceName ?? '',
    address?.dimensionSpacePoint ?? '',
    address?.nodeAggregateId ?? '',
  ] as const
}

/** A node type filter and whether removed nodes are read along. */
function filterKey(nodeTypes?: string, removed = false) {
  return { nodeTypes: nodeTypes ?? null, ...(removed ? { removed } : {}) }
}

export const neosKeys = {
  me: ['me'] as const,
  /** The own editable profile - nested under `me` so invalidating me covers it. */
  profile: ['me', 'profile'] as const,
  contentRepository: ['contentRepository'] as const,
  sites: {
    all: ['sites'] as const,
    /** Site packages + site node types for the creation dialog. */
    options: ['sites', 'options'] as const,
  },
  users: {
    all: ['users'] as const,
    /** The assignable roles - nested under `users` so invalidating users covers it. */
    options: ['users', 'options'] as const,
  },
  workspaces: {
    all: ['workspaces'] as const,
    workspace: (name: string) => ['workspaces', name] as const,
    changes: (name: string) => ['workspaces', name, 'changes'] as const,
    roles: (name: string) => ['workspaces', name, 'roles'] as const,
  },
  nodeTypes: {
    all: ['nodeTypes'] as const,
    /** The listing with an include, e.g. properties,references. */
    listing: (include: string) => ['nodeTypes', 'listing', include] as const,
    nodeType: (name: string) => ['nodeTypes', 'nodeType', name] as const,
  },
  nodes: {
    all: ['nodes'] as const,
    /** Prefix covering every read of the nodes in a workspace. */
    workspace: (contentRepositoryId: string, workspaceName: string) =>
      ['nodes', contentRepositoryId, workspaceName] as const,
    /** Prefix covering every read of one node - for invalidation, not for reading. */
    node: (address: NodeAddress | null) =>
      ['nodes', ...nodeKey(address)] as const,
    /**
     * `removed` marks a read that deliberately included removed (deleted)
     * nodes - a different result than the same node read normally, so it must
     * not share a cache entry with it.
     */
    get: (address: NodeAddress | null, nodeTypes?: string, removed = false) =>
      ['nodes', ...nodeKey(address), filterKey(nodeTypes, removed)] as const,
    children: (
      address: NodeAddress | null,
      nodeTypes?: string,
      removed = false,
    ) =>
      [
        'nodes',
        ...nodeKey(address),
        'children',
        filterKey(nodeTypes, removed),
      ] as const,
    ancestors: (address: NodeAddress | null) =>
      ['nodes', ...nodeKey(address), 'ancestors'] as const,
    variants: (address: NodeAddress | null) =>
      ['nodes', ...nodeKey(address), 'variants'] as const,
    references: (address: NodeAddress | null) =>
      ['nodes', ...nodeKey(address), 'references'] as const,
    allowedChildNodeTypes: (address: NodeAddress | null) =>
      ['nodes', ...nodeKey(address), 'allowed-child-node-types'] as const,
    /** Descendants of the node: a search, or the document toolbar's filter. */
    descendants: (
      address: NodeAddress | null,
      query: { nodeTypes: string; search?: string; title?: string },
    ) => ['nodes', ...nodeKey(address), 'descendants', query] as const,
  },
  dataSources: {
    all: ['dataSources'] as const,
    /** One data source invocation - keyed by everything that reaches getData(). */
    data: (
      identifier: string,
      node: NodeAddress | null,
      additionalData: Record<string, unknown> | null,
    ) => ['dataSources', identifier, { node, additionalData }] as const,
  },
  assets: {
    /** Broad prefix - invalidate after any asset, collection or tag write. */
    all: ['assets'] as const,
    sources: ['assets', 'sources'] as const,
    /** The paginated asset list; the filter object keys the infinite query. */
    list: (filter: Record<string, unknown>) =>
      ['assets', 'list', filter] as const,
    asset: (assetSourceId: string, assetId: string) =>
      ['assets', 'asset', assetSourceId, assetId] as const,
    usages: (assetSourceId: string, assetId: string) =>
      ['assets', 'asset', assetSourceId, assetId, 'usages'] as const,
    collections: ['assets', 'collections'] as const,
    tags: ['assets', 'tags'] as const,
  },
}
