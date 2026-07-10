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
  sites: ['sites'] as const,
  workspaces: ['workspaces'] as const,
  nodeTypes: ['nodeTypes'] as const,
  dimensions: ['dimensions'] as const,
  nodes: {
    all: ['nodes'] as const,
    byAddress: (address: string) => ['nodes', address] as const,
    children: (address: string, nodeTypes?: string) =>
      ['nodes', address, 'children', { nodeTypes: nodeTypes ?? null }] as const,
  },
}
