import { useQuery } from '@tanstack/react-query'
import { queryClient } from '@/app/queryClient'
import { apiFetch, type Listing } from '../client'
import { neosKeys } from '../keys'
import type {
  Domain,
  DomainCreate,
  DomainUpdate,
  NodeAddress,
  Site,
  SiteCreate,
  SiteCreationOptions,
  SiteUpdate,
} from '../schema'

/**
 * The sites (Neos.Api's Sites tag). Sites are addressed by their node name,
 * domains by their id. Reading is open to every editor; the writes are
 * administration (sites.create/update/delete).
 */

async function listSites(): Promise<Site[]> {
  return (await apiFetch<Listing<Site>>('/sites')).data
}

export function useSites(enabled = true) {
  return useQuery({
    queryKey: neosKeys.sites.all,
    queryFn: listSites,
    enabled,
  })
}

/** Imperative variant of useSites. */
export function fetchSites(): Promise<Site[]> {
  return queryClient.fetchQuery({
    queryKey: neosKeys.sites.all,
    queryFn: listSites,
  })
}

/**
 * The site node in a workspace and dimension space point (the site's default
 * one if none is given), null for a site without a site node.
 */
export function siteNodeAddress(
  site: Site,
  workspaceName: string,
  dimensionSpacePoint: string = site.defaultDimensionSpacePoint,
): NodeAddress | null {
  return site.nodeAggregateId === null
    ? null
    : {
        contentRepositoryId: site.contentRepositoryId,
        workspaceName,
        dimensionSpacePoint,
        nodeAggregateId: site.nodeAggregateId,
      }
}

/** Site packages + site node types for the creation dialog. */
export function useSiteCreationOptions(enabled = true) {
  return useQuery({
    queryKey: neosKeys.sites.options,
    queryFn: () => apiFetch<SiteCreationOptions>('/options/sites'),
    enabled,
  })
}

function sitePath(siteNodeName: string): string {
  return `/sites/${encodeURIComponent(siteNodeName)}`
}

function domainPath(siteNodeName: string, domainId: string): string {
  return `${sitePath(siteNodeName)}/domains/${encodeURIComponent(domainId)}`
}

export function createSite(input: SiteCreate): Promise<Site> {
  return apiFetch<Site>('/sites', { method: 'POST', body: input })
}

export function updateSite(
  siteNodeName: string,
  input: SiteUpdate,
): Promise<Site> {
  return apiFetch<Site>(sitePath(siteNodeName), {
    method: 'PATCH',
    body: input,
  })
}

export async function deleteSite(siteNodeName: string): Promise<void> {
  await apiFetch(sitePath(siteNodeName), { method: 'DELETE' })
}

export function createDomain(
  siteNodeName: string,
  input: DomainCreate,
): Promise<Domain> {
  return apiFetch<Domain>(`${sitePath(siteNodeName)}/domains`, {
    method: 'POST',
    body: input,
  })
}

/** Partial update; scheme null / port null clear them. */
export function updateDomain(
  siteNodeName: string,
  domainId: string,
  input: DomainUpdate,
): Promise<Domain> {
  return apiFetch<Domain>(domainPath(siteNodeName, domainId), {
    method: 'PATCH',
    body: input,
  })
}

export async function deleteDomain(
  siteNodeName: string,
  domainId: string,
): Promise<void> {
  await apiFetch(domainPath(siteNodeName, domainId), { method: 'DELETE' })
}
