import { useQuery } from '@tanstack/react-query'
import { queryClient } from '@/app/queryClient'
import { apiFetch, isNotFound, queryString, type Listing } from './client'
import { queryKeys } from './keys'
import { addressOf } from './nodeAddress'

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

/** Neos.Api's Site. */
interface ApiSite {
  nodeName: string
  name: string
  online: boolean
  contentRepositoryId: string
  siteResourcesPackageKey: string
  domains: SiteDomain[]
  primaryDomain: string | null
  nodeAggregateId: string | null
  /** JSON, e.g. {"language":"en"} */
  defaultDimensionSpacePoint: string
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
   * this site. null if the site has no site node.
   */
  aggregateId: string | null
  /**
   * The site node in the listing's workspace and dimension space point; null
   * if the site node does not exist there (a site created after the
   * workspace was forked, until it is synchronized).
   */
  nodeAddress: string | null
}

export interface SitesResponse {
  workspace: string
  /** The point the addresses are in: the requested one, else the default. */
  dimensionSpacePoint: Record<string, string>
  sites: Site[]
}

function parsePoint(json: string): Record<string, string> {
  try {
    const point = JSON.parse(json) as unknown
    return point !== null && typeof point === 'object'
      ? (point as Record<string, string>)
      : {}
  } catch {
    return {}
  }
}

/**
 * Whether the site node exists in the given subgraph. Neos.Api lists sites
 * independent of workspaces; only reading the node tells. Anything but a 404
 * counts as present - the node reads report their own errors.
 */
async function siteNodeExists(
  site: ApiSite,
  workspace: string,
  dimensionSpacePoint: Record<string, string>,
): Promise<boolean> {
  if (site.nodeAggregateId === null) return false
  try {
    await apiFetch(
      `/cr/${encodeURIComponent(site.contentRepositoryId)}/nodes/${encodeURIComponent(site.nodeAggregateId)}${queryString(
        {
          workspaceName: workspace,
          dimensionSpacePoint: JSON.stringify(dimensionSpacePoint),
        },
      )}`,
    )
    return true
  } catch (error) {
    return !isNotFound(error)
  }
}

function toSite(
  site: ApiSite,
  workspace: string,
  dimensionSpacePoint: Record<string, string>,
  exists = true,
): Site {
  return {
    name: site.name,
    nodeName: site.nodeName,
    state: site.online ? 'online' : 'offline',
    siteResourcesPackageKey: site.siteResourcesPackageKey,
    domains: site.domains,
    primaryDomain: site.primaryDomain,
    aggregateId: site.nodeAggregateId,
    nodeAddress:
      site.nodeAggregateId !== null && exists
        ? addressOf({
            contentRepositoryId: site.contentRepositoryId,
            workspaceName: workspace,
            dimensionSpacePoint,
            nodeAggregateId: site.nodeAggregateId,
          })
        : null,
  }
}

/** A site as returned by a write - addressed in live, its own default point. */
function writtenSite(site: ApiSite): Site {
  return toSite(site, 'live', parsePoint(site.defaultDimensionSpacePoint))
}

/**
 * Sites with their node addresses in the given workspace and dimension space
 * point, so all node traversal that starts from them stays in the same
 * subgraph. With dimensions=null the addresses use the default point of the
 * sites (the first online site's), reported as dimensionSpacePoint.
 */
function sitesQuery(
  workspace: string,
  dimensions: Record<string, string> | null,
) {
  return {
    queryKey: queryKeys.sites(workspace, dimensions),
    queryFn: async (): Promise<SitesResponse> => {
      const listing = await apiFetch<Listing<ApiSite>>('/sites')
      const reference =
        listing.data.find((site) => site.online) ?? listing.data[0]
      const dimensionSpacePoint =
        dimensions ??
        (reference ? parsePoint(reference.defaultDimensionSpacePoint) : {})
      const exists = await Promise.all(
        listing.data.map((site) =>
          siteNodeExists(site, workspace, dimensionSpacePoint),
        ),
      )
      return {
        workspace,
        dimensionSpacePoint,
        sites: listing.data.map((site, index) =>
          toSite(site, workspace, dimensionSpacePoint, exists[index]),
        ),
      }
    },
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
 * Everything below is the administration side (sites.create/update/delete,
 * administrators only); callers gate on me.permissions.sites. Sites are
 * addressed by their node name, domains by their id from the listing.
 * Callers invalidate queryKeys.sitesAll because the listing is keyed per
 * workspace/dimensions.
 */

export interface SiteOptionsResponse {
  packages: string[]
  nodeTypes: { name: string; label: string }[]
}

/** Site packages + site node types for the creation dialog. */
export function useSiteOptions(enabled = true) {
  return useQuery({
    queryKey: queryKeys.siteOptions,
    queryFn: () => apiFetch<SiteOptionsResponse>('/options/sites'),
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
  /** An active domain of the site to become its primary domain. */
  primaryDomainId?: string
}

export interface CreateDomainInput {
  hostname: string
  scheme?: 'http' | 'https'
  port?: number
  active?: boolean
}

/** Partial update; scheme null / port null clear them. */
export interface UpdateDomainInput {
  hostname?: string
  scheme?: 'http' | 'https' | null
  port?: number | null
  active?: boolean
}

function sitePath(siteNodeName: string): string {
  return `/sites/${encodeURIComponent(siteNodeName)}`
}

export async function createSite(input: CreateSiteInput): Promise<Site> {
  const { inactive, ...rest } = input
  const site = await apiFetch<ApiSite>('/sites', {
    method: 'POST',
    body: { ...rest, ...(inactive ? { online: false } : {}) },
  })
  return writtenSite(site)
}

export async function updateSite(
  siteNodeName: string,
  input: UpdateSiteInput,
): Promise<Site> {
  const { state, ...rest } = input
  const site = await apiFetch<ApiSite>(sitePath(siteNodeName), {
    method: 'PATCH',
    body: {
      ...rest,
      ...(state !== undefined ? { online: state === 'online' } : {}),
    },
  })
  return writtenSite(site)
}

export async function deleteSite(siteNodeName: string): Promise<void> {
  await apiFetch<null>(sitePath(siteNodeName), { method: 'DELETE' })
}

export function createDomain(
  siteNodeName: string,
  input: CreateDomainInput,
): Promise<SiteDomain> {
  return apiFetch<SiteDomain>(`${sitePath(siteNodeName)}/domains`, {
    method: 'POST',
    body: input,
  })
}

export function updateDomain(
  siteNodeName: string,
  domainId: string,
  input: UpdateDomainInput,
): Promise<SiteDomain> {
  return apiFetch<SiteDomain>(
    `${sitePath(siteNodeName)}/domains/${encodeURIComponent(domainId)}`,
    { method: 'PATCH', body: input },
  )
}

export async function deleteDomain(
  siteNodeName: string,
  domainId: string,
): Promise<void> {
  await apiFetch<null>(
    `${sitePath(siteNodeName)}/domains/${encodeURIComponent(domainId)}`,
    { method: 'DELETE' },
  )
}
