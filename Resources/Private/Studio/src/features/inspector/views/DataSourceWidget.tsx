import { useDataSource } from '@/api/dataSources'
import type { NodeDto } from '@/api/nodes'
import { Skeleton } from '@/components/ui/skeleton'
import { plainEditorOption } from '@/features/inspector/inspectorSchema'
import { translate as t } from '@/lib/i18n'

/**
 * The shared fetch-and-frame behind the data views (Column/Table/TimeSeries):
 * invokes the configured data source with the inspected node and the
 * `arguments` option (ClientEval inside them is already evaluated by the
 * inspector), renders the loading/error states, and hands the result to the
 * view body. The classic UI's `dataSourceUri` option bypasses the data source
 * registry with a free-form URL - the Studio API has no such passthrough, so
 * it is called out as unsupported instead of failing silently.
 */
export function DataSourceWidget({
  node,
  options,
  children,
}: {
  node: NodeDto
  options: Record<string, unknown>
  children: (data: unknown) => React.ReactNode
}) {
  const identifier =
    typeof options.dataSource === 'string' && options.dataSource !== ''
      ? options.dataSource
      : null
  const subtitle = plainEditorOption(options, 'subtitle')
  const { data, error, isLoading } = useDataSource({
    identifier,
    nodeAddress: node.address,
    additionalData:
      options.arguments !== null &&
      typeof options.arguments === 'object' &&
      !Array.isArray(options.arguments)
        ? (options.arguments as Record<string, unknown>)
        : undefined,
  })

  return (
    <div className="space-y-2">
      {subtitle && <p className="text-xs text-neutral-400">{subtitle}</p>}
      {identifier === null ? (
        <WidgetNotice
          message={
            typeof options.dataSourceUri === 'string'
              ? t(
                  'view.dataSourceUriUnsupported',
                  'dataSourceUri is not supported - register a data source and reference it via the dataSource option.',
                )
              : t(
                  'view.noDataSource',
                  'No data source configured for this view.',
                )
          }
        />
      ) : error ? (
        <WidgetNotice
          message={error instanceof Error ? error.message : String(error)}
        />
      ) : isLoading ? (
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : (
        children(data)
      )}
    </div>
  )
}

function WidgetNotice({ message }: { message: string }) {
  return (
    <p className="flex items-start gap-1.5 text-xs text-neutral-400">
      <i
        className="fas fa-triangle-exclamation mt-0.5 text-[0.75rem] shrink-0 text-red-500"
        aria-hidden
      />
      {message}
    </p>
  )
}
