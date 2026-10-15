import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import {
  configuredLabel,
  type NodeTypeMap,
  useNodeType,
} from '@/api/neos/endpoints/nodeTypes'
import {
  type CreationDialogElementConfig,
  type Node,
  type NodeTypeConfiguration,
  nodeTypeConfiguration,
  type PropertyConfig,
} from '@/api/neos/schema'
import { toast } from '@/components/ui/toast'
import { translate as t } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  defaultEditorForType,
  editorOptionsFor,
  humanizeLabel,
} from '@/features/inspector/inspectorSchema'
import { useAssetPicker } from '@/features/media/AssetPicker'
import { TEXT_FIELD_EDITOR } from '@/features/inspector/editors/TextFieldEditor'
import { usePropertyEditor } from '@/features/inspector/editors/registry'
import { validateValue } from '@/features/inspector/validators'
import { ValidationErrors } from '@/features/inspector/validators/ValidationErrors'
import { NodeTypeIcon } from '@/features/tree/nodeTypeIcon'
import { sortByPosition } from '@/lib/positional'
import { createNode, type CreateNodeRequest } from './createNode'

interface CreationElement {
  name: string
  label: string
  required: boolean
  config: CreationDialogElementConfig
}

/**
 * A property or reference asked for in the creation dialog
 * (ui.showInCreationDialog) as the element of its name - what Neos UI's
 * CreationDialogPostprocessor derives from the property's inspector
 * configuration.
 */
function promotedElement(
  config: PropertyConfig,
  type: string,
): CreationDialogElementConfig {
  return {
    type,
    defaultValue: config.defaultValue,
    position: config.ui?.inspector?.position,
    ui: {
      label: config.ui?.label,
      editor: config.ui?.inspector?.editor,
      editorOptions: config.ui?.inspector?.editorOptions,
    },
    validation: config.validation,
  }
}

/**
 * The node type's creation dialog elements by name: ui.creationDialog.elements
 * plus every property and reference shown in the creation dialog that no
 * configured element of its name replaces.
 */
function creationDialogElements(
  configuration: NodeTypeConfiguration,
): Record<string, CreationDialogElementConfig | null> {
  const elements = { ...(configuration.ui?.creationDialog?.elements ?? {}) }
  for (const [name, config] of Object.entries(configuration.properties ?? {})) {
    if (!config?.ui?.showInCreationDialog || name in elements) continue
    elements[name] = promotedElement(config, config.type ?? 'string')
  }
  for (const [name, config] of Object.entries(configuration.references ?? {})) {
    if (!config?.ui?.showInCreationDialog || name in elements) continue
    elements[name] = promotedElement(
      config,
      config.constraints?.maxItems === 1 ? 'reference' : 'references',
    )
  }
  return elements
}

/** A reference element's value (one id, or a list of them) as target ids. */
function referenceTargets(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((id): id is string => typeof id === 'string')
  }
  return typeof value === 'string' ? [value] : []
}

/**
 * Runs one node creation: fetches the node type, shows its creation dialog
 * when it has elements (ui.creationDialog.elements and the properties and
 * references with ui.showInCreationDialog, mirroring the classic
 * NodeCreationDialog) and creates the node via Neos.Api. Types without a
 * creation dialog are created immediately, without any UI.
 *
 * The Studio does what the classic UI's promoted-elements handler did:
 * element values named like a property become its initial value, those named
 * like a reference its references. A node type with node creation handlers
 * (options.nodeCreationHandlers: Flowpack.NodeTemplates and the like) gets
 * all of the dialog's values as elements as well, which the Studio's
 * createNodeFromCreationDialog runs its handlers with. A document's
 * uriPathSegment, unless an element sets it, is derived by the server (from
 * the title, else unique from the node type), as in the Neos backend.
 */
export function CreateNodeFlow({
  request,
  nodeTypes,
  onCreated,
  onCancel,
}: {
  request: CreateNodeRequest
  nodeTypes: NodeTypeMap | undefined
  /** The node exists; the new node. */
  onCreated: (node: Node) => void
  /** The user cancelled, or creation failed after the dialog was skipped. */
  onCancel: (error?: string) => void
}) {
  const { data: nodeType, error: schemaError } = useNodeType(
    request.nodeTypeName,
  )
  const configuration = useMemo(
    () => (nodeType ? nodeTypeConfiguration(nodeType) : null),
    [nodeType],
  )
  const [creating, setCreating] = useState(false)
  // An asset/image element hands off to the Media Library, which takes over the
  // main area. This dialog is a modal overlaying everything (portalled to
  // <body>), so it must step aside for the pick or it covers the picker. It
  // stays mounted - only visually closed - so the in-progress draft survives,
  // and reopens when the pick resolves or is cancelled.
  const { session: pickerSession } = useAssetPicker()
  const picking = pickerSession !== null

  const elements = useMemo(() => {
    if (!configuration) return null
    const configured = creationDialogElements(configuration)
    const order = sortByPosition(
      Object.entries(configured).map(([key, config]) => ({
        key,
        position: config?.position,
      })),
    )
    return order
      .map((name): CreationElement | null => {
        const config = configured[name]
        if (!config || config.ui?.hidden === true) return null
        return {
          name,
          label: humanizeLabel(config.ui?.label, name),
          required:
            config.validation?.['Neos.Neos/Validation/NotEmptyValidator'] !==
            undefined,
          config,
        }
      })
      .filter((element): element is CreationElement => element !== null)
  }, [configuration])

  // The defaults, known with the elements (the editors only render then): the
  // element's own defaultValue, or the mapped property's - what the CR would
  // apply anyway, but visible and editable before creating.
  const defaults = useMemo(() => {
    const result: Record<string, unknown> = {}
    const properties = configuration?.properties ?? {}
    for (const element of elements ?? []) {
      const defaultValue =
        element.config.defaultValue ?? properties[element.name]?.defaultValue
      if (defaultValue !== undefined) result[element.name] = defaultValue
    }
    return result
  }, [elements, configuration])
  // The user's input over the defaults - what Create submits.
  const [edits, setEdits] = useState<Record<string, unknown>>({})
  const values = { ...defaults, ...edits }
  // Elements the user has edited: inline errors only show for these, so the
  // dialog does not open with every required field already flagged red - the
  // disabled Create button and the * markers cover the untouched state.
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set())

  const typeLabel = humanizeLabel(
    configuredLabel(nodeTypes?.get(request.nodeTypeName)),
    request.nodeTypeName.split(':').pop() ?? request.nodeTypeName,
  )

  const submit = async (submittedValues: Record<string, unknown>) => {
    setCreating(true)
    const properties = configuration?.properties ?? {}
    const references = configuration?.references ?? {}
    const initialPropertyValues: Record<string, unknown> = {}
    const initialReferences: Record<string, string[]> = {}
    const handlers = configuration?.options?.nodeCreationHandlers
    const elementValues: Record<string, unknown> | null =
      handlers && Object.values(handlers).some((handler) => handler !== null)
        ? {}
        : null
    for (const [name, value] of Object.entries(submittedValues)) {
      if (value === undefined || value === null || value === '') continue
      if (name in properties) {
        initialPropertyValues[name] = value
      } else if (name in references) {
        const targets = referenceTargets(value)
        if (targets.length > 0) initialReferences[name] = targets
      }
      if (elementValues !== null) {
        elementValues[name] =
          name in references ? referenceTargets(value) : value
      }
    }
    try {
      onCreated(
        await createNode(
          request,
          initialPropertyValues,
          initialReferences,
          elementValues,
        ),
      )
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      // With a dialog open the user can retry or cancel; without one the
      // flow is invisible - surface the failure through onCancel.
      if (elements !== null && elements.length > 0) {
        toast.error(message, {
          title: t('creation.creatingFailed', 'Creating failed'),
        })
        setCreating(false)
      } else {
        onCancel(message)
      }
    }
  }

  // No creation dialog configured - create right away (exactly once). An
  // effect event: it runs the current submit, but only elements trigger it.
  const autoSubmitted = useRef(false)
  const submitWithoutDialog = useEffectEvent(() => {
    autoSubmitted.current = true
    void submit({})
  })
  useEffect(() => {
    if (elements === null || elements.length > 0 || autoSubmitted.current)
      return
    submitWithoutDialog()
  }, [elements])

  // A schema that fails to load ends the flow - reported once per error, to
  // the onCancel of the moment.
  const cancelWithError = useEffectEvent((error: unknown) =>
    onCancel(error instanceof Error ? error.message : String(error)),
  )
  useEffect(() => {
    if (schemaError) cancelWithError(schemaError)
  }, [schemaError])

  if (elements === null || elements.length === 0) return null

  // Every element's validation block, run against the live draft - the same
  // registry-backed validators the inspector uses. Any error disables Create;
  // "required" is just the NotEmptyValidator, so the old missing-required
  // gate is subsumed.
  const validationErrors: Record<string, string[]> = {}
  for (const element of elements) {
    const errors = validateValue(
      values[element.name],
      element.config.validation,
    )
    if (errors.length > 0) validationErrors[element.name] = errors
  }
  const hasErrors = Object.keys(validationErrors).length > 0

  return (
    <Dialog
      open={!picking}
      onOpenChange={(open) => !open && !picking && !creating && onCancel()}
    >
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <NodeTypeIcon
              nodeTypes={nodeTypes}
              nodeTypeName={request.nodeTypeName}
              className="text-[1rem]"
            />
            {t('creation.createType', 'Create {0}', [typeLabel])}
          </DialogTitle>
        </DialogHeader>

        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (!creating && !hasErrors) void submit(values)
          }}
        >
          {elements.map((element, index) => (
            <ElementEditor
              key={element.name}
              element={element}
              autoFocus={index === 0}
              value={values[element.name]}
              errors={
                touched.has(element.name)
                  ? validationErrors[element.name]
                  : undefined
              }
              onChange={(value) => {
                setEdits((previous) => ({
                  ...previous,
                  [element.name]: value,
                }))
                setTouched((previous) =>
                  previous.has(element.name)
                    ? previous
                    : new Set(previous).add(element.name),
                )
              }}
            />
          ))}
        </form>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onCancel()}
            disabled={creating}
          >
            {t('creation.cancel', 'Cancel')}
          </Button>
          <Button
            onClick={() => void submit(values)}
            disabled={creating || hasErrors}
          >
            {creating
              ? t('creation.creating', 'Creating…')
              : t('creation.create', 'Create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * One creation-dialog field: the label plus the control, rendered by the editor
 * the element configures (or its type's default), resolved through the shared
 * property editor registry - the same editors the inspector uses. The label
 * sits above the control, unless the editor renders its own (a checkbox puts
 * its label beside the box). An unregistered editor degrades to a plain text
 * field: unlike the inspector, the creation form must stay editable.
 */
function ElementEditor({
  element,
  autoFocus = false,
  value,
  errors,
  onChange,
}: {
  element: CreationElement
  autoFocus?: boolean
  value: unknown
  /** Validation errors for the element's current draft value - rendered inline below the control. */
  errors?: string[]
  onChange: (value: unknown) => void
}) {
  const type = element.config.type ?? 'string'
  const editorId =
    element.config.ui?.editor ?? defaultEditorForType(type) ?? TEXT_FIELD_EDITOR
  // Stable: editors derive state from their options (the rich text editor
  // even recreates itself for new ones).
  const configuredOptions = element.config.ui?.editorOptions
  const options = useMemo(
    () => editorOptionsFor(type, editorId, configuredOptions),
    [type, editorId, configuredOptions],
  )
  const definition = usePropertyEditor(editorId)
  const Editor = definition?.component
  const invalid = errors !== undefined && errors.length > 0

  const control = Editor ? (
    <Editor
      subject={{ name: element.name, type, label: element.label }}
      value={value}
      options={options}
      autoFocus={autoFocus}
      invalid={invalid}
      // The dialog keeps a live draft it submits on Create, so it tracks both
      // per-keystroke changes and commits (its validation gates the Create
      // button and must stay current as the user types).
      onChange={onChange}
      onCommit={onChange}
    />
  ) : (
    <Input
      autoFocus={autoFocus}
      value={typeof value === 'string' ? value : ''}
      aria-invalid={invalid || undefined}
      onChange={(event) => onChange(event.target.value)}
    />
  )

  // The editor renders its own label (e.g. a checkbox): show it as-is, without
  // wrapping in a <label> (which would nest labels) or adding one above.
  if (definition?.rendersOwnLabel) {
    return (
      <div className="text-sm">
        {control}
        <ValidationErrors errors={errors} />
      </div>
    )
  }

  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">
        {element.label}
        {element.required && <span className="text-red-500"> *</span>}
      </span>
      {control}
      <ValidationErrors errors={errors} />
    </label>
  )
}
