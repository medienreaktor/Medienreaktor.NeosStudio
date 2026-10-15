import type { NodeAddress } from './schema'

/**
 * Query keys of everything read from Neos.Api. Keys are hierarchical so
 * invalidation can be as broad or as narrow as a write's effects require, e.g.
 *
 *   queryClient.invalidateQueries({ queryKey: neosKeys.nodes.all })
 *   queryClient.invalidateQueries({ queryKey: neosKeys.nodes.node(address) })
 *
 * Every Neos.Api query takes its key from here - never inline key literals in
 * hooks, or invalidation silently misses them. The Studio's operations have
 * theirs in api/studio/keys.ts. What belongs to a content repository has its
 * ID right after the key's root, so the root covers all of them.
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
  /** A content repository with its dimensions. */
  contentRepository: (contentRepositoryId: string) =>
    ['contentRepository', contentRepositoryId] as const,
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
  /**
   * By content repository, after the prefix covering all of them. The list
   * and the reads of one workspace differ in the segment after the content
   * repository ('list' vs 'workspace'), so no workspace name can collide
   * with the list.
   */
  workspaces: {
    all: ['workspaces'] as const,
    /** Prefix covering every workspace read of the content repository. */
    contentRepository: (contentRepositoryId: string) =>
      ['workspaces', contentRepositoryId] as const,
    list: (contentRepositoryId: string) =>
      ['workspaces', contentRepositoryId, 'list'] as const,
    /** Prefix covering every read of one workspace. */
    workspace: (contentRepositoryId: string, name: string) =>
      ['workspaces', contentRepositoryId, 'workspace', name] as const,
    /** Prefix covering every read of the workspace's pending changes. */
    changes: (contentRepositoryId: string, name: string) =>
      [
        'workspaces',
        contentRepositoryId,
        'workspace',
        name,
        'changes',
      ] as const,
    /**
     * The pending changes (all, or of one site) with the workspace - under
     * `changes`.
     */
    pendingChanges: (
      contentRepositoryId: string,
      name: string,
      filterBySite: string | null,
    ) =>
      [
        'workspaces',
        contentRepositoryId,
        'workspace',
        name,
        'changes',
        'pending',
        { filterBySite },
      ] as const,
    roles: (contentRepositoryId: string, name: string) =>
      ['workspaces', contentRepositoryId, 'workspace', name, 'roles'] as const,
    /**
     * The changes grouped by document (all, or of one site), for the review -
     * under `changes`.
     */
    review: (
      contentRepositoryId: string,
      name: string,
      filterBySite: string | null,
    ) =>
      [
        'workspaces',
        contentRepositoryId,
        'workspace',
        name,
        'changes',
        'review',
        { filterBySite },
      ] as const,
    /** One document's changes with their diffs - under `changes`. */
    documentDiff: (
      contentRepositoryId: string,
      name: string,
      documentId: string,
    ) =>
      [
        'workspaces',
        contentRepositoryId,
        'workspace',
        name,
        'changes',
        'document',
        documentId,
      ] as const,
    /** Prefix covering the deleted pages of every site - under `changes`. */
    trashes: (contentRepositoryId: string, name: string) =>
      [
        'workspaces',
        contentRepositoryId,
        'workspace',
        name,
        'changes',
        'trash',
      ] as const,
    /** The deleted pages (all, or of one site) - under `trashes`. */
    trash: (
      contentRepositoryId: string,
      name: string,
      filterBySite: string | null,
    ) =>
      [
        'workspaces',
        contentRepositoryId,
        'workspace',
        name,
        'changes',
        'trash',
        { filterBySite },
      ] as const,
    /**
     * The labels of conflicting nodes, read in a dimension space point -
     * under `changes`.
     */
    conflicts: (
      contentRepositoryId: string,
      name: string,
      dimensionSpacePoint: string,
      nodeAggregateIds: string[],
    ) =>
      [
        'workspaces',
        contentRepositoryId,
        'workspace',
        name,
        'changes',
        'conflicts',
        dimensionSpacePoint,
        nodeAggregateIds,
      ] as const,
    /** Prefix covering every read of the workspace's events. */
    history: (contentRepositoryId: string, name: string) =>
      ['workspaces', contentRepositoryId, 'workspace', name, 'events'] as const,
    /** The newest events (up to limit), for the pending history - under `history`. */
    pendingEvents: (contentRepositoryId: string, name: string, limit: number) =>
      [
        'workspaces',
        contentRepositoryId,
        'workspace',
        name,
        'events',
        'pending',
        limit,
      ] as const,
    /** The newest events in one document, for its history - under `history`. */
    documentEvents: (
      contentRepositoryId: string,
      name: string,
      documentId: string,
    ) =>
      [
        'workspaces',
        contentRepositoryId,
        'workspace',
        name,
        'events',
        'document',
        documentId,
      ] as const,
    /** A range of events with their diffs - under `history`. */
    eventsDiff: (
      contentRepositoryId: string,
      name: string,
      from: number,
      to: number,
    ) =>
      [
        'workspaces',
        contentRepositoryId,
        'workspace',
        name,
        'events',
        'diff',
        from,
        to,
      ] as const,
  },
  /** By content repository, after the prefix covering all of them. */
  nodeTypes: {
    all: ['nodeTypes'] as const,
    /** The listing with an include, e.g. properties,references. */
    listing: (contentRepositoryId: string, include: string) =>
      ['nodeTypes', contentRepositoryId, 'listing', include] as const,
    nodeType: (contentRepositoryId: string, name: string) =>
      ['nodeTypes', contentRepositoryId, 'nodeType', name] as const,
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
    /** Broad prefix covering every media read. */
    all: ['assets'] as const,
    sources: ['assets', 'sources'] as const,
    /** Prefix covering every page of every asset list. */
    lists: ['assets', 'list'] as const,
    /** The paginated asset list; the filter object keys the infinite query. */
    list: (filter: Record<string, unknown>) =>
      ['assets', 'list', filter] as const,
    /** Prefix covering every read of single assets (and their usages). */
    assets: ['assets', 'asset'] as const,
    asset: (assetSourceId: string, assetId: string) =>
      ['assets', 'asset', assetSourceId, assetId] as const,
    usages: (assetSourceId: string, assetId: string) =>
      ['assets', 'asset', assetSourceId, assetId, 'usages'] as const,
    collections: ['assets', 'collections'] as const,
    tags: ['assets', 'tags'] as const,
  },
}
