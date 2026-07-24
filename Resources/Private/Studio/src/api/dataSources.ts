import { useQuery } from '@tanstack/react-query'
import { apiFetch } from './client'
import { queryKeys } from './keys'

/**
 * Neos data sources: server-side DataSourceInterface implementations that
 * populate select-box style editors, invoked through /api/data-sources/{id}.
 * The endpoint forwards every extra query parameter to the data source as its
 * $arguments array (the editorOptions.dataSourceAdditionalData contract) and
 * wraps the raw getData() return value in a {"data": ...} envelope.
 */

/** Flatten a value into PHP-parseable query params (bracket notation for nesting). */
function appendParam(
  search: URLSearchParams,
  key: string,
  value: unknown,
): void {
  if (value === null || value === undefined) return
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      appendParam(search, `${key}[${index}]`, item),
    )
  } else if (typeof value === 'object') {
    for (const [childKey, childValue] of Object.entries(value)) {
      appendParam(search, `${key}[${childKey}]`, childValue)
    }
  } else {
    search.append(key, String(value))
  }
}

export interface UseDataSourceParams {
  /** The data source identifier (editorOptions.dataSourceIdentifier). Disabled while null. */
  identifier: string | null
  /** Address of the node the editor operates on - becomes getData()'s $node. Absent in the creation dialog. */
  nodeAddress?: string
  /** editorOptions.dataSourceAdditionalData - forwarded as getData()'s $arguments. */
  additionalData?: Record<string, unknown>
  /** editorOptions.dataSourceDisableCaching - refetch on every mount instead of caching for the session. */
  disableCaching?: boolean
}

/**
 * Invoke a data source and cache the result for the session (the old UI's
 * LRU-cache semantics), keyed by identifier + node + arguments so a changed
 * input refetches. Returns the raw getData() value - use
 * dataSourceSelectOptions() to normalize it for a select control.
 */
export function useDataSource({
  identifier,
  nodeAddress,
  additionalData,
  disableCaching = false,
}: UseDataSourceParams) {
  return useQuery({
    queryKey: queryKeys.dataSources.byIdentifier(
      identifier ?? '',
      nodeAddress ?? null,
      additionalData ?? null,
    ),
    queryFn: async () => {
      const search = new URLSearchParams()
      if (nodeAddress) search.set('node', nodeAddress)
      for (const [key, value] of Object.entries(additionalData ?? {})) {
        appendParam(search, key, value)
      }
      const query = search.toString()
      const response = await apiFetch<{ data: unknown }>(
        `/data-sources/${encodeURIComponent(identifier ?? '')}${query ? `?${query}` : ''}`,
      )
      return response.data
    },
    enabled: identifier !== null && identifier !== '',
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
 * Normalize a raw data source result into select options. Data sources return
 * either an array of {value, label, group?, icon?, disabled?} entries or a
 * map of {key: {label, ...}} (both shapes the old UI accepted); anything
 * unrecognizable is skipped. Order is preserved - the data source decides it.
 */
export function dataSourceSelectOptions(data: unknown): DataSourceOption[] {
  if (data === null || typeof data !== 'object') return []

  const options: DataSourceOption[] = []
  const push = (value: unknown, entry: Record<string, unknown>) => {
    if (value === null || value === undefined) return
    options.push({
      key: String(value),
      value,
      label:
        typeof entry.label === 'string' && entry.label !== ''
          ? entry.label
          : String(value),
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
