/**
 * Central query-key factory. Keys are hierarchical so invalidation can be as
 * broad or as narrow as a command's effects require, e.g.
 *
 *   queryClient.invalidateQueries({ queryKey: queryKeys.nodes.all })
 *   queryClient.invalidateQueries({ queryKey: queryKeys.nodes.children(address) })
 *
 * Every query in the app must take its key from here — never inline key
 * literals in hooks, or invalidation silently misses them.
 */
export const queryKeys = {
  me: ['me'] as const,
  /** The own editable profile - nested under `me` so invalidating me covers it. */
  profile: ['me', 'profile'] as const,
  /** Prefix covering every sites listing variant AND the options - for invalidation after site writes. */
  sitesAll: ['sites'] as const,
  sites: (workspace: string, dimensions: Record<string, string> | null) =>
    ['sites', { workspace, dimensions }] as const,
  /** Site packages + site node types for the creation dialog. */
  siteOptions: ['sites', 'options'] as const,
  workspaces: {
    all: ['workspaces'] as const,
    changes: (name: string) => ['workspaces', name, 'changes'] as const,
    documentChanges: (name: string) =>
      ['workspaces', name, 'document-changes'] as const,
    pendingEvents: (name: string) =>
      ['workspaces', name, 'pending-events'] as const,
    roles: (name: string) => ['workspaces', name, 'roles'] as const,
  },
  nodeTypes: {
    all: ['nodeTypes'] as const,
    /** The listing variant carrying every type's property/reference declarations. */
    withProperties: ['nodeTypes', 'with-properties'] as const,
    schema: (name: string) => ['nodeTypes', 'schema', name] as const,
  },
  dimensions: ['dimensions'] as const,
  users: ['users'] as const,
  /** The assignable-role catalog - nested under `users` so invalidating users covers it. */
  userRoles: ['users', 'roles'] as const,
  dataSources: {
    all: ['dataSources'] as const,
    /** One data source invocation - keyed by everything that reaches getData(). */
    byIdentifier: (
      identifier: string,
      node: string | null,
      additionalData: Record<string, unknown> | null,
    ) => ['dataSources', identifier, { node, additionalData }] as const,
  },
  nodes: {
    all: ['nodes'] as const,
    /** Prefix covering every cached variant (any nodeTypes filter) of one address - for invalidation, not for reading. */
    node: (address: string) => ['nodes', address] as const,
    byAddress: (address: string, nodeTypes?: string) =>
      ['nodes', address, { nodeTypes: nodeTypes ?? null }] as const,
    children: (address: string, nodeTypes?: string) =>
      ['nodes', address, 'children', { nodeTypes: nodeTypes ?? null }] as const,
    ancestors: (address: string, nodeTypes?: string) =>
      [
        'nodes',
        address,
        'ancestors',
        { nodeTypes: nodeTypes ?? null },
      ] as const,
    variants: (address: string) => ['nodes', address, 'variants'] as const,
    allowedChildNodeTypes: (address: string) =>
      ['nodes', address, 'allowed-child-node-types'] as const,
    references: (address: string) => ['nodes', address, 'references'] as const,
    search: (address: string, nodeTypes: string, term: string) =>
      ['nodes', address, 'search', { nodeTypes, term }] as const,
    /** The document toolbar's filtered flat listing (title search + node type filter, unpaginated). */
    filteredDescendants: (address: string, nodeTypes: string, term: string) =>
      ['nodes', address, 'filtered-descendants', { nodeTypes, term }] as const,
  },
  media: {
    /** Broad prefix - invalidate after any asset/collection/tag write. */
    all: ['media'] as const,
    sources: ['media', 'asset-sources'] as const,
    /** The paginated asset list; the filter object keys the infinite query. */
    assets: (filter: Record<string, unknown>) =>
      ['media', 'assets', filter] as const,
    asset: (assetSource: string, identifier: string) =>
      ['media', 'asset', assetSource, identifier] as const,
    assetUsage: (assetSource: string, identifier: string) =>
      ['media', 'asset', assetSource, identifier, 'usage'] as const,
    collections: ['media', 'collections'] as const,
    tags: ['media', 'tags'] as const,
  },
}
