import { COLUMN_VIEW, ColumnView } from './ColumnView'
import { NODE_INFO_VIEW, NodeInfoView } from './NodeInfoView'
import { inspectorViewRegistry } from './registry'
import { TABLE_VIEW, TableView } from './TableView'
import { TIME_SERIES_VIEW, TimeSeriesView } from './TimeSeriesView'

/**
 * Studio's built-in inspector views, registered under the Neos view
 * identifiers that node type configuration references - one file per view,
 * mirroring the built-in property editors.
 */

export {
  COLUMN_VIEW,
  ColumnView,
  NODE_INFO_VIEW,
  NodeInfoView,
  TABLE_VIEW,
  TableView,
  TIME_SERIES_VIEW,
  TimeSeriesView,
}

/**
 * Register the built-in views. Called once before the app mounts, exactly
 * like third-party views would be registered from a plugin entry point.
 */
export function registerBuiltinInspectorViews(): void {
  inspectorViewRegistry.register({
    id: NODE_INFO_VIEW,
    component: NodeInfoView,
  })
  inspectorViewRegistry.register({
    id: COLUMN_VIEW,
    component: ColumnView,
  })
  inspectorViewRegistry.register({
    id: TABLE_VIEW,
    component: TableView,
  })
  inspectorViewRegistry.register({
    id: TIME_SERIES_VIEW,
    component: TimeSeriesView,
  })
}
