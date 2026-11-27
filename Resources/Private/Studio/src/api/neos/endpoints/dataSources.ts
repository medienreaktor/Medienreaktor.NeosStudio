import { queryOptions, skipToken, useQuery } from '@tanstack/react-query'
import { queryClient } from '@/app/queryClient'
import { api, unwrap } from '../client'
import { neosKeys } from '../keys'
import type { NodeAddress } from '../schema'

/**
 * Neos data sources (Neos.Api's DataSources tag): server-side
 * DataSourceInterface implementations that populate select-box style
 * editors. The arguments[...] query parameters become the data source's
 * $arguments (the editorOptions.dataSourceAdditionalData contract), the node
 * parameters its $node; the raw getData() value comes back as `data`.
 */

export interface UseDataSourceParams {
  /** The data source identifier (editorOptions.dataSourceIdentifier). Disabled while null. */
  identifier: string | null
  /** The node the editor operates on - getData()'s $node. Absent in the creation dialog. */
  node?: NodeAddress | null
  /** editorOptions.dataSourceAdditionalData - forwarded as getData()'s $arguments. */
  additionalData?: Record<string, unknown>
  /** editorOptions.dataSourceDisableCaching - refetch on every mount instead of caching for the session. */
  disableCaching?: boolean
}

/**
 * The query of a data source, cached for the session (the old UI's
 * LRU-cache semantics), keyed by identifier + node + arguments so a changed
 * input refetches. Resolves with the raw getData() value.
 */
function dataSourceQuery({
  identifier,
  node,
  additionalData,
  disableCaching = false,
}: UseDataSourceParams) {
  return queryOptions({
    queryKey: neosKeys.dataSources.data(
      identifier ?? '',
      node
        ? {
            contentRepositoryId: node.contentRepositoryId,
            workspaceName: node.workspaceName,
            dimensionSpacePoint: node.dimensionSpacePoint,
            nodeAggregateId: node.nodeAggregateId,
          }
        : null,
      additionalData ?? null,
    ),
    queryFn:
      identifier !== null && identifier !== ''
        ? async ({ signal }) => {
            const response = await unwrap(
              api.GET('/datasources/{dataSourceId}', {
                params: {
                  path: { dataSourceId: identifier },
                  query: {
                    // Nested in bracket notation at any depth by the
                    // client's query serializer - the PHP side reads them
                    // back as the $arguments array.
                    arguments: additionalData ?? undefined,
                    ...(node
                      ? {
                          contentRepositoryId: node.contentRepositoryId,
                          nodeAggregateId: node.nodeAggregateId,
                          workspaceName: node.workspaceName,
                          dimensionSpacePoint: node.dimensionSpacePoint,
                        }
                      : {}),
                  },
                },
                signal,
              }),
            )
            return response.data as unknown
          }
        : skipToken,
    staleTime: disableCaching ? 0 : Infinity,
  })
}

/** Invoke a data source - see dataSourceQuery. */
export function useDataSource(params: UseDataSourceParams) {
  return useQuery({
    ...dataSourceQuery(params),
    refetchOnMount: params.disableCaching ? 'always' : false,
  })
}

/** Imperative variant of useDataSource, sharing its cache entries. */
export function fetchDataSource(
  params: UseDataSourceParams & { identifier: string },
): Promise<unknown> {
  return queryClient.fetchQuery(dataSourceQuery(params))
}
