import type { NodeDto } from '@/api/nodes'
import type { InspectorView } from '@/features/inspector/inspectorSchema'
import { Labeled } from '@/features/inspector/PropertyEditor'
import { translate as t } from '@/lib/i18n'
import { useInspectorView } from './registry'

/**
 * One view in the inspector: resolves the configured view id through the
 * inspector view registry and hands it the inspected node and its
 * viewOptions, or renders a placeholder when no view is registered for the
 * id (an unimplemented or plugin-provided view that is not loaded). The label
 * renders above the view like a property label.
 */
export function InspectorViewRenderer({
  view,
  node,
}: {
  view: InspectorView
  node: NodeDto
}) {
  const definition = useInspectorView(view.view)
  if (!definition) {
    return (
      <Labeled label={view.label}>
        <div
          className="min-h-9 rounded-md border border-dashed border-neutral-700 px-3 py-2 text-sm text-neutral-400"
          title={t('view.notSupported', 'View not supported yet: {0}', [
            view.view ?? t('view.noneConfigured', '(none configured)'),
          ])}
        >
          {t('view.notSupported', 'View not supported yet: {0}', [
            view.view ?? t('view.noneConfigured', '(none configured)'),
          ])}
        </div>
      </Labeled>
    )
  }
  const View = definition.component
  return (
    <Labeled label={view.label}>
      <View node={node} label={view.label} options={view.viewOptions} />
    </Labeled>
  )
}
