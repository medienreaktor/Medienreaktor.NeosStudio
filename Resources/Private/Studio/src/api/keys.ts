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
  sites: (workspace: string, dimensions: Record<string, string> | null) =>
    ['sites', { workspace, dimensions }] as const,
  workspaces: {
    all: ['workspaces'] as const,
    changes: (name: string) => ['workspaces', name, 'changes'] as const,
  },
  nodeTypes: {
    all: ['nodeTypes'] as const,
    schema: (name: string) => ['nodeTypes', 'schema', name] as const,
  },
  dimensions: ['dimensions'] as const,
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
  },
}
