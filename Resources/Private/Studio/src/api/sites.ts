import { useQuery } from '@tanstack/react-query'
import { queryClient } from '@/app/queryClient'
import { apiFetch } from './client'
import { queryKeys } from './keys'

/** One configured domain of a site. */
export interface SiteDomain {
  /** Stable domain id for updates and deletion. */
  id: string
  hostname: string
  scheme: 'http' | 'https' | null
  port: number | null
  active: boolean
  /** True for the explicitly configured primary domain. */
  isPrimary: boolean
  /** The rendered URI, e.g. "https://example.com". */
  url: string
}

export interface Site {
  name: string
  nodeName: string
  /** "offline" sites are hidden from the site switcher but still editable. */
  state: 'online' | 'offline'
  siteResourcesPackageKey: string
  domains: SiteDomain[]
  /** The effective primary domain URI (explicit or first active), or null. */
  primaryDomain: string | null
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

/**
 * Everything below is the administration side (Api.Sites.Write, admins only);
 * callers gate on me.permissions.sites. Sites are addressed by their node
 * name, domains by their id from the listing. Every mutation returns the
 * fresh site; callers still invalidate queryKeys.sitesAll because the listing
 * is keyed per workspace/dimensions.
 */

export interface SiteOptionsResponse {
  packages: { packageKey: string }[]
  nodeTypes: { name: string; label: string }[]
}

/** Site packages + site node types for the creation dialog. */
export function useSiteOptions(enabled = true) {
  return useQuery({
    queryKey: queryKeys.siteOptions,
    queryFn: () => apiFetch<SiteOptionsResponse>('/sites/options'),
    enabled,
  })
}

export interface CreateSiteInput {
  packageKey: string
  name: string
  nodeTypeName: string
  /** Derived from the name when omitted. */
  nodeName?: string
  inactive?: boolean
}

export interface UpdateSiteInput {
  name?: string
  state?: 'online' | 'offline'
  /** A domain id, or an empty string to fall back to the first active domain. */
  primaryDomainId?: string
}

export interface CreateDomainInput {
  hostname: string
  scheme?: 'http' | 'https'
  port?: number
  active?: boolean
}

/** Partial update; scheme "" clears the scheme, port 0 clears the port. */
export interface UpdateDomainInput {
  hostname?: string
  scheme?: 'http' | 'https' | ''
  port?: number
  active?: boolean
}

export function createSite(input: CreateSiteInput) {
  return apiFetch<{ site: Site }>('/sites', { method: 'POST', body: input })
}

export function updateSite(siteNodeName: string, input: UpdateSiteInput) {
  return apiFetch<{ site: Site }>(
    `/sites/${encodeURIComponent(siteNodeName)}`,
    { method: 'PATCH', body: input },
  )
}

export function deleteSite(siteNodeName: string) {
  return apiFetch<{ success: boolean }>(
    `/sites/${encodeURIComponent(siteNodeName)}`,
    { method: 'DELETE' },
  )
}

export function createDomain(siteNodeName: string, input: CreateDomainInput) {
  return apiFetch<{ site: Site }>(
    `/sites/${encodeURIComponent(siteNodeName)}/domains`,
    { method: 'POST', body: input },
  )
}

export function updateDomain(
  siteNodeName: string,
  domainId: string,
  input: UpdateDomainInput,
) {
  return apiFetch<{ site: Site }>(
    `/sites/${encodeURIComponent(siteNodeName)}/domains/${encodeURIComponent(domainId)}`,
    { method: 'PATCH', body: input },
  )
}

export function deleteDomain(siteNodeName: string, domainId: string) {
  return apiFetch<{ site: Site }>(
    `/sites/${encodeURIComponent(siteNodeName)}/domains/${encodeURIComponent(domainId)}`,
    { method: 'DELETE' },
  )
}
