import { humanizeLabel } from '@/features/inspector/inspectorSchema'
import { DataSourceWidget } from './DataSourceWidget'
import { dataText } from './dataPath'
import type { InspectorViewComponent } from './registry'

export const COLUMN_VIEW = 'Neos.Neos/Inspector/Views/Data/ColumnView'

/**
 * Stat columns over a data source result: an optional hero number plus small
 * label/value columns, each reading a path from the result (viewOptions
 * `hero: {label, data}` and `columns: [{label, data}]` - the classic UI's
 * ColumnView contract).
 */
export const ColumnView: InspectorViewComponent = ({ node, options }) => {
  const hero =
    options.hero !== null && typeof options.hero === 'object'
      ? (options.hero as Record<string, unknown>)
      : null
  const columns = Array.isArray(options.columns)
    ? options.columns.filter(
        (column): column is Record<string, unknown> =>
          column !== null && typeof column === 'object',
      )
    : []
  const label = (column: Record<string, unknown>, fallback: string): string =>
    humanizeLabel(
      typeof column.label === 'string' ? column.label : null,
      fallback,
    )

  return (
    <DataSourceWidget node={node} options={options}>
      {(data) => (
        <div className="space-y-3">
          {hero && (
            <div>
              <div className="text-2xl font-semibold text-neutral-950 dark:text-white tabular-nums">
                {dataText(data, hero.data)}
              </div>
              <div className="text-xs text-neutral-600 dark:text-neutral-400">
                {label(hero, 'hero')}
              </div>
            </div>
          )}
          {columns.length > 0 && (
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
              {columns.map((column, index) => (
                <div key={index} className="min-w-0">
                  <div className="truncate text-sm font-medium text-neutral-950 dark:text-white tabular-nums">
                    {dataText(data, column.data)}
                  </div>
                  <div className="truncate text-xs text-neutral-600 dark:text-neutral-400">
                    {label(column, `column ${index + 1}`)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </DataSourceWidget>
  )
}
