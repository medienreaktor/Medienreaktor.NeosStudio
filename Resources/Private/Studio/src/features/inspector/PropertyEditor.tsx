import type { SerializedPropertyValue } from '@/api/nodes'
import { usePropertyEditorComponent } from '@/features/properties/registry'
import type { InspectorProperty } from './inspectorSchema'

/**
 * One property in the inspector: resolves the configured editor through the
 * shared property editor registry and hands it the property's value, or renders
 * a read-only value when no editor is registered for the id (an unimplemented
 * or plugin-provided editor that is not loaded). Mount with a key of node
 * address + property name - the editor's draft state must reset when the edited
 * subject changes, but survive the node refetch after a save.
 */
export function PropertyEditor({
  property,
  value,
  onSave,
}: {
  property: InspectorProperty
  value: SerializedPropertyValue | undefined
  onSave: (propertyName: string, value: unknown) => void
}) {
  const Editor = usePropertyEditorComponent(property.editor)
  if (!Editor) return <ReadOnlyValue property={property} value={value} />

  return (
    <Editor
      subject={{ name: property.name, type: property.type, label: property.label }}
      value={value?.value}
      options={property.editorOptions}
      // The inspector auto-saves: persist on commit, ignore live pre-commit
      // changes (they would be a save per keystroke).
      onCommit={(next) => onSave(property.name, next)}
    />
  )
}

/** Properties whose editor is not registered - read out, not editable. */
function ReadOnlyValue({
  property,
  value,
}: {
  property: InspectorProperty
  value: SerializedPropertyValue | undefined
}) {
  return (
    <div
      className="min-h-9 rounded-md border border-dashed border-input px-3 py-2 text-sm wrap-break-word whitespace-pre-wrap text-muted-foreground"
      title={`Editor not supported yet: ${property.editor ?? property.type}`}
    >
      {formatValue(value)}
    </div>
  )
}

function formatValue(value: SerializedPropertyValue | undefined): string {
  const raw = value?.value
  if (raw === null || raw === undefined || raw === '') return '–'
  if (typeof raw === 'string') return raw
  if (typeof raw === 'boolean') return raw ? 'Yes' : 'No'
  if (typeof raw === 'number') return String(raw)
  return JSON.stringify(raw)
}
