import { useQuery } from '@tanstack/react-query'
import { queryClient } from '@/app/queryClient'
import { apiFetch } from './client'
import { queryKeys } from './keys'

export interface Site {
  name: string
  nodeName: string
  /** null if the site node does not exist in the current subgraph */
  nodeAddress: string | null
}

export interface SitesResponse {
  workspace: string
  dimensionSpacePoint: Record<string, string>
  sites: Site[]
}

/**
 * Sites in the given workspace. The returned node addresses encode the
 * workspace, so all node traversal that starts from them stays in it.
 */
function sitesQuery(workspace: string) {
  return {
    queryKey: queryKeys.sites(workspace),
    queryFn: () => apiFetch<SitesResponse>(`/sites?workspace=${encodeURIComponent(workspace)}`),
  }
}

export function useSites(workspace: string | null, enabled = true) {
  return useQuery({ ...sitesQuery(workspace ?? ''), enabled: enabled && workspace !== null })
}

/** Imperative variant for non-hook contexts. */
export function fetchSites(workspace: string): Promise<SitesResponse> {
  return queryClient.fetchQuery(sitesQuery(workspace))
}
