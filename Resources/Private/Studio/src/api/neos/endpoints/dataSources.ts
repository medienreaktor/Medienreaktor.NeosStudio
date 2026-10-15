import { skipToken, useQuery } from '@tanstack/react-query'
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
 * Invoke a data source and cache the result for the session (the old UI's
 * LRU-cache semantics), keyed by identifier + node + arguments so a changed
 * input refetches. Resolves with the raw getData() value.
 */
export function useDataSource({
  identifier,
  node,
  additionalData,
  disableCaching = false,
}: UseDataSourceParams) {
  return useQuery({
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
            return response.data
          }
        : skipToken,
    staleTime: disableCaching ? 0 : Infinity,
    refetchOnMount: disableCaching ? 'always' : false,
  })
}

/** One selectable option, normalized from a data source result. */
export interface DataSourceOption {
  /** Stable string key for the select control. */
  key: string
  /** The value as the data source returned it - this is what gets committed. */
  value: unknown
  label: string
  group?: string
  icon?: string
  disabled?: boolean
}

/**
 * The select options of a data source result. Data sources return either an
 * array of {value, label, group?, icon?, disabled?} entries or a map of
 * {key: {label, ...}} (both shapes the old UI accepted); anything
 * unrecognizable is skipped. Order is preserved - the data source decides it.
 */
export function dataSourceSelectOptions(data: unknown): DataSourceOption[] {
  if (data === null || typeof data !== 'object') return []

  const options: DataSourceOption[] = []
  const push = (value: unknown, entry: Record<string, unknown>) => {
    if (value === null || value === undefined) return
    // Object values (e.g. {id, type}) keyed by their JSON - String() would
    // give them all the same "[object Object]".
    const key =
      typeof value === 'object' ? JSON.stringify(value) : String(value)
    options.push({
      key,
      value,
      label:
        typeof entry.label === 'string' && entry.label !== ''
          ? entry.label
          : key,
      group: typeof entry.group === 'string' ? entry.group : undefined,
      icon: typeof entry.icon === 'string' ? entry.icon : undefined,
      disabled: entry.disabled === true,
    })
  }

  if (Array.isArray(data)) {
    for (const entry of data) {
      if (entry === null || typeof entry !== 'object') continue
      push(
        (entry as Record<string, unknown>).value,
        entry as Record<string, unknown>,
      )
    }
  } else {
    for (const [key, entry] of Object.entries(data)) {
      push(
        key,
        entry !== null && typeof entry === 'object'
          ? (entry as Record<string, unknown>)
          : {},
      )
    }
  }

  return options
}
