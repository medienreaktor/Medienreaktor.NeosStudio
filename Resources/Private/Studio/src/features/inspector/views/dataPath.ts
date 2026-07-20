/**
 * Resolve a dotted data path ("rows[0].value", "totals.count") against a data
 * source result - the lodash.get subset the classic UI's view options rely on
 * (ColumnView/TableView/TimeSeriesView `data`, `collection`, `valueData`, ...).
 */
export function dataPath(data: unknown, path: unknown): unknown {
  if (typeof path !== 'string' || path === '') return undefined
  let current: unknown = data
  for (const segment of path.replace(/\[(\d+)\]/g, '.$1').split('.')) {
    if (segment === '') continue
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

/** The collection a view iterates: the path's value when it is an array. */
export function dataCollection(data: unknown, path: unknown): unknown[] {
  const collection = dataPath(data, path)
  return Array.isArray(collection) ? collection : []
}

/** A path's value as display text; objects and undefined render as a dash. */
export function dataText(data: unknown, path: unknown): string {
  const value = dataPath(data, path)
  if (value === null || value === undefined) return '–'
  if (typeof value === 'object') return '–'
  return String(value)
}
