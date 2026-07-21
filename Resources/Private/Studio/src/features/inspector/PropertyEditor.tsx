import type { PropertyScope } from '@/api/nodeTypes'
import type { SerializedPropertyValue } from '@/api/nodes'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { usePropertyEditor } from '@/features/inspector/editors/registry'
import { translateLabel } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type { InspectorProperty } from './inspectorSchema'
import { ValidationErrors } from './validators/ValidationErrors'

/**
 * One property in the inspector: resolves the configured editor through the
 * shared property editor registry and hands it the property's value, or renders
 * a read-only value when no editor is registered for the id (an unimplemented
 * or plugin-provided editor that is not loaded). Owns the property label too -
 * rendered above the control, unless the editor renders its own (a checkbox
 * puts its label beside the box). Mount with a key of node address + property
 * name so the editor's draft state resets when the edited subject changes, but
 * survives the node refetch after a save.
 */
export function PropertyEditor({
  property,
  value,
  nodeAddress,
  errors,
  onSave,
  onLiveChange,
}: {
  property: InspectorProperty
  value: SerializedPropertyValue | undefined
  /** Address of the node being edited, passed to editors that operate on the node itself (e.g. the node type switcher). */
  nodeAddress: string
  /** Validation errors for the property's current (live) value - rendered inline below the control. */
  errors?: string[]
  onSave: (propertyName: string, value: unknown) => void
  /** A keystroke-level (pre-commit) value change; the inspector feeds these to ClientEval so dependent fields react while typing. */
  onLiveChange?: (propertyName: string, value: unknown) => void
}) {
  const definition = usePropertyEditor(property.editor)
  if (!definition) {
    return (
      <Labeled label={property.label} scope={property.scope}>
        <ReadOnlyValue property={property} value={value} />
      </Labeled>
    )
  }

  const Editor = definition.component
  const editor = (
    <Editor
      subject={{
        name: property.name,
        type: property.type,
        label: property.label,
      }}
      value={value?.value}
      options={property.editorOptions}
      nodeAddress={nodeAddress}
      invalid={errors !== undefined && errors.length > 0}
      // The inspector auto-saves: persist on commit. Live pre-commit changes
      // are never persisted (that would be a save per keystroke), but they do
      // feed ClientEval so dependent fields react while typing.
      onCommit={(next) => onSave(property.name, next)}
      onChange={(next) => onLiveChange?.(property.name, next)}
    />
  )
  const inlineErrors = <ValidationErrors errors={errors} />

  if (definition.rendersOwnLabel) {
    // The editor owns the label line (e.g. the checkbox label beside the box),
    // so the scope hint sits next to the whole control instead; the wrapper's
    // text color tints the editor's own label text purple by inheritance.
    if (property.scope === 'node')
      return (
        <>
          {editor}
          {inlineErrors}
        </>
      )
    return (
      <>
        <div className="flex items-center gap-1.5 text-purple-300">
          {editor}
          <ScopeHint scope={property.scope} />
        </div>
        {inlineErrors}
      </>
    )
  }
  return (
    <Labeled label={property.label} scope={property.scope}>
      {editor}
      {inlineErrors}
    </Labeled>
  )
}

/** The property label above its control - the default inspector field layout. */
export function Labeled({
  label,
  scope,
  children,
}: {
  label: string
  /** When given and not "node", the label carries the variant-spanning hint icon. */
  scope?: PropertyScope
  children: React.ReactNode
}) {
  const spansVariants = scope !== undefined && scope !== 'node'
  return (
    <>
      <label
        className={cn(
          'mb-1 flex items-center gap-1.5 text-xs',
          // Purple marks dimension-spanning edits, matching the dimension UI.
          spansVariants ? 'text-purple-300' : 'text-white',
        )}
      >
        {label}
        {spansVariants && <ScopeHint scope={scope} />}
      </label>
      {children}
    </>
  )
}

/**
 * English fallbacks for the classic UI's propertyScope.* hints, used when the
 * XLIFF bundle does not carry them.
 */
const SCOPE_HINTS: Record<Exclude<PropertyScope, 'node'>, string> = {
  nodeAggregate:
    'The value of this property is shared across all dimension variants.',
  specializations:
    'Changes to this property will affect all specialization variants.',
}

/** A small icon flagging that edits to this property span dimension variants. */
function ScopeHint({ scope }: { scope: Exclude<PropertyScope, 'node'> }) {
  const hint =
    translateLabel(`Neos.Neos.Ui:Main:propertyScope.${scope}`) ??
    SCOPE_HINTS[scope]
  return (
    <Tooltip>
      <TooltipTrigger
        aria-label={hint}
        className="cursor-help text-purple-300 hover:text-purple-200"
      >
        <i className="fas fa-right-left text-[0.75rem]" aria-hidden />
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
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
      className="min-h-9 rounded-md border border-dashed border-neutral-700 px-3 py-2 text-sm wrap-break-word whitespace-pre-wrap text-neutral-400"
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
