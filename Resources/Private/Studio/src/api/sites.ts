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

const sitesQuery = {
  queryKey: queryKeys.sites,
  queryFn: () => apiFetch<SitesResponse>('/sites'),
}

export function useSites(enabled = true) {
  return useQuery({ ...sitesQuery, enabled })
}

/** Imperative variant for non-hook contexts (e.g. the tree data loader). */
export function fetchSites(): Promise<SitesResponse> {
  return queryClient.fetchQuery(sitesQuery)
}
