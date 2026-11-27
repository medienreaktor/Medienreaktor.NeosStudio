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
