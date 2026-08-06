import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'
import { Placeholder } from '@/components/ui/placeholder'
import { FaIcon } from '@/features/tree/nodeTypeIcon'
import { translate as t } from '@/lib/i18n'
import { DataSourceWidget } from './DataSourceWidget'
import { dataCollection, dataPath, dataText } from './dataPath'
import type { InspectorViewComponent } from './registry'

export const TABLE_VIEW = 'Neos.Neos/Inspector/Views/Data/TableView'

/**
 * A table over a data source result: viewOptions name the `collection` path
 * to iterate and the `columns` to read from each row (`data` path, optional
 * `suffix`, optional `iconMap` mapping a cell value to a Font Awesome icon) -
 * the classic UI's TableView contract.
 */
export const TableView: InspectorViewComponent = ({ node, options }) => {
  const columns = Array.isArray(options.columns)
    ? options.columns.filter(
        (column): column is Record<string, unknown> =>
          column !== null && typeof column === 'object',
      )
    : []

  return (
    <DataSourceWidget node={node} options={options}>
      {(data) => {
        const rows = dataCollection(data, options.collection)
        if (rows.length === 0 || columns.length === 0) {
          return (
            <Placeholder
              icon="fa-table"
              title={t('view.noData', 'No data.')}
              className="py-6"
            />
          )
        }
        return (
          <Table className="text-xs">
            <TableBody>
              {rows.map((row, rowIndex) => (
                <TableRow key={rowIndex}>
                  {columns.map((column, columnIndex) => {
                    const value = dataText(row, column.data)
                    const iconMap =
                      column.iconMap !== null &&
                      typeof column.iconMap === 'object'
                        ? (column.iconMap as Record<string, unknown>)
                        : null
                    const icon = iconMap?.[String(dataPath(row, column.data))]
                    return (
                      <TableCell key={columnIndex} className="px-1 py-1.5">
                        {typeof icon === 'string' && (
                          <FaIcon
                            icon={icon}
                            className="mr-1 text-neutral-600 dark:text-neutral-400"
                          />
                        )}
                        {value}
                        {typeof column.suffix === 'string' && column.suffix}
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )
      }}
    </DataSourceWidget>
  )
}
