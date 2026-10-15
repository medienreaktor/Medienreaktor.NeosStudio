import { skipToken, useQuery } from '@tanstack/react-query'
import { api, unwrap } from '../client'
import { neosKeys } from '../keys'
import type {
  Domain,
  DomainCreate,
  DomainUpdate,
  NodeAddress,
  Site,
  SiteCreate,
  SiteUpdate,
} from '../schema'

/**
 * The sites (Neos.Api's Sites tag). Sites are addressed by their node name,
 * domains by their id. Reading is open to every editor; the writes are
 * administration (sites.create/update/delete).
 */

export function useSites(enabled = true) {
  return useQuery({
    queryKey: neosKeys.sites.all,
    queryFn: enabled
      ? async ({ signal }): Promise<Site[]> =>
          (await unwrap(api.GET('/sites', { signal }))).data
      : skipToken,
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
    queryFn: enabled
      ? ({ signal }) => unwrap(api.GET('/options/sites', { signal }))
      : skipToken,
  })
}

export function createSite(input: SiteCreate): Promise<Site> {
  return unwrap(api.POST('/sites', { body: input }))
}

export function updateSite(
  siteNodeName: string,
  input: SiteUpdate,
): Promise<Site> {
  return unwrap(
    api.PATCH('/sites/{siteNodeName}', {
      params: { path: { siteNodeName } },
      body: input,
    }),
  )
}

export async function deleteSite(siteNodeName: string): Promise<void> {
  await unwrap(
    api.DELETE('/sites/{siteNodeName}', {
      params: { path: { siteNodeName } },
    }),
  )
}

export function createDomain(
  siteNodeName: string,
  input: DomainCreate,
): Promise<Domain> {
  return unwrap(
    api.POST('/sites/{siteNodeName}/domains', {
      params: { path: { siteNodeName } },
      body: input,
    }),
  )
}

/** Partial update; scheme null / port null clear them. */
export function updateDomain(
  siteNodeName: string,
  domainId: string,
  input: DomainUpdate,
): Promise<Domain> {
  return unwrap(
    api.PATCH('/sites/{siteNodeName}/domains/{domainId}', {
      params: { path: { siteNodeName, domainId } },
      body: input,
    }),
  )
}

export async function deleteDomain(
  siteNodeName: string,
  domainId: string,
): Promise<void> {
  await unwrap(
    api.DELETE('/sites/{siteNodeName}/domains/{domainId}', {
      params: { path: { siteNodeName, domainId } },
    }),
  )
}
