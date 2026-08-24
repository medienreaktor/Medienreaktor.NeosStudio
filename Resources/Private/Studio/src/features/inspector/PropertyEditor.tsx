import type { PropertyScope } from '@/api/nodeTypes'
import type { SerializedPropertyValue } from '@/api/nodes'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { usePropertyEditor } from '@/features/inspector/editors/registry'
import { translate as t, translateLabel } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type {
  InspectorProperty,
  InspectorPropertyHelp,
} from './inspectorSchema'
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
      <Labeled
        label={property.label}
        scope={property.scope}
        help={property.help}
      >
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
    // so the help and scope hints sit next to the whole control instead; the
    // wrapper's text color tints the editor's own label text purple by
    // inheritance when edits span dimension variants.
    if (property.scope === 'node' && !property.help)
      return (
        <>
          {editor}
          {inlineErrors}
        </>
      )
    return (
      <>
        <div
          className={cn(
            'flex items-center gap-1.5',
            property.scope !== 'node' && 'text-purple-700 dark:text-purple-300',
          )}
        >
          {editor}
          {property.help && <HelpHint help={property.help} />}
          {property.scope !== 'node' && <ScopeHint scope={property.scope} />}
        </div>
        {inlineErrors}
      </>
    )
  }
  return (
    <Labeled label={property.label} scope={property.scope} help={property.help}>
      {editor}
      {inlineErrors}
    </Labeled>
  )
}

/** The property label above its control - the default inspector field layout. */
export function Labeled({
  label,
  scope,
  help,
  children,
}: {
  label: string
  /** When given and not "node", the label carries the variant-spanning hint icon. */
  scope?: PropertyScope
  /** When given, the label carries the ui.help popover trigger. */
  help?: InspectorPropertyHelp | null
  children: React.ReactNode
}) {
  const spansVariants = scope !== undefined && scope !== 'node'
  return (
    <>
      <div
        className={cn(
          'mb-1 flex items-center gap-1.5 text-xs',
          // Purple marks dimension-spanning edits, matching the dimension UI.
          spansVariants
            ? 'text-purple-700 dark:text-purple-300'
            : 'text-neutral-950 dark:text-white',
        )}
      >
        {/* The hint icons sit OUTSIDE the label element: a label forwards
            clicks to its first labelable descendant, which would open the
            popover from anywhere on the label text. */}
        <label>{label}</label>
        {help && <HelpHint help={help} />}
        {spansVariants && <ScopeHint scope={scope} />}
      </div>
      {children}
    </>
  )
}

/**
 * A hint beside a property label: a small icon toggling a popover - opened
 * by clicking the icon itself, never the surrounding label. Shared by the
 * ui.help and property-scope hints so both look and behave identically.
 */
function HintPopover({
  icon,
  label,
  className,
  children,
}: {
  /** FontAwesome icon name, e.g. "fa-circle-question". */
  icon: string
  /** Accessible name for the trigger icon. */
  label: string
  /** Color classes for the trigger icon. */
  className: string
  children: React.ReactNode
}) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label={label}
        className={cn('cursor-help', className)}
      >
        <i className={cn('fas text-[0.75rem]', icon)} aria-hidden />
      </PopoverTrigger>
      <PopoverContent className="max-w-72 py-2 px-3 text-xs leading-relaxed">
        {children}
      </PopoverContent>
    </Popover>
  )
}

/**
 * The ui.help affordance beside a property label: a question-mark icon
 * opening a popover with the integrator's guidance - the message, and the
 * thumbnail when one resolved (mirroring the classic UI's help popover).
 */
function HelpHint({ help }: { help: InspectorPropertyHelp }) {
  return (
    <HintPopover
      icon="fa-circle-question"
      label={t('inspector.help', 'Help')}
      className="text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
    >
      {help.thumbnail && (
        <img
          src={help.thumbnail}
          alt=""
          className={cn('max-w-full rounded', help.message && 'mb-2')}
        />
      )}
      {help.message && <p className="whitespace-pre-wrap">{help.message}</p>}
    </HintPopover>
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
    <HintPopover
      icon="fa-right-left"
      label={hint}
      className="text-purple-700 dark:text-purple-300 hover:text-purple-800 dark:hover:text-purple-200"
    >
      {hint}
    </HintPopover>
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
      className="min-h-9 rounded-md border border-dashed border-neutral-300 dark:border-neutral-700 px-3 py-2 text-sm wrap-break-word whitespace-pre-wrap text-neutral-600 dark:text-neutral-400"
      title={t(
        'inspector.editorNotSupported',
        'Editor not supported yet: {0}',
        [property.editor ?? property.type],
      )}
    >
      {formatValue(value)}
    </div>
  )
}

function formatValue(value: SerializedPropertyValue | undefined): string {
  const raw = value?.value
  if (raw === null || raw === undefined || raw === '') return '–'
  if (typeof raw === 'string') return raw
  if (typeof raw === 'boolean')
    return raw ? t('inspector.yes', 'Yes') : t('inspector.no', 'No')
  if (typeof raw === 'number') return String(raw)
  return JSON.stringify(raw)
}
