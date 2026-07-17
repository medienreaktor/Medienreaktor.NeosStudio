import { useQuery } from '@tanstack/react-query'
import { queryClient } from '@/app/queryClient'
import { apiFetch } from './client'
import { queryKeys } from './keys'

export interface Site {
  name: string
  nodeName: string
  /**
   * The site node's aggregate id - used to scope workspace publish/discard to
   * this site. null if the site node does not exist in the current subgraph.
   */
  aggregateId: string | null
  /** null if the site node does not exist in the current subgraph */
  nodeAddress: string | null
}

export interface SitesResponse {
  workspace: string
  dimensionSpacePoint: Record<string, string>
  sites: Site[]
}

/**
 * Sites in the given workspace and dimension space point. The returned node
 * addresses encode both, so all node traversal that starts from them stays in
 * the same subgraph. With dimensions=null the backend picks its default (the
 * first root generalization) and reports it as dimensionSpacePoint.
 */
function sitesQuery(
  workspace: string,
  dimensions: Record<string, string> | null,
) {
  const dimensionsParam =
    dimensions !== null
      ? `&dimensions=${encodeURIComponent(JSON.stringify(dimensions))}`
      : ''
  return {
    queryKey: queryKeys.sites(workspace, dimensions),
    queryFn: () =>
      apiFetch<SitesResponse>(
        `/sites?workspace=${encodeURIComponent(workspace)}${dimensionsParam}`,
      ),
  }
}

export function useSites(
  workspace: string | null,
  dimensions: Record<string, string> | null,
  enabled = true,
) {
  return useQuery({
    ...sitesQuery(workspace ?? '', dimensions),
    enabled: enabled && workspace !== null,
  })
}

/** Imperative variant for non-hook contexts. */
export function fetchSites(
  workspace: string,
  dimensions: Record<string, string> | null = null,
): Promise<SitesResponse> {
  return queryClient.fetchQuery(sitesQuery(workspace, dimensions))
}
