import { useEffect, useMemo, useRef, useState } from 'react'
import { generateUriPathSegment } from '@/api/nodes'
import {
  type CreationDialogElementConfig,
  type NodeTypeMap,
  isOfType,
  useNodeTypeSchema,
} from '@/api/nodeTypes'
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
  humanizeLabel,
} from '@/features/inspector/inspectorSchema'
import { useAssetPicker } from '@/features/media/AssetPicker'
import { TEXT_FIELD_EDITOR } from '@/features/inspector/editors'
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

const DOCUMENT_SUPER_TYPE = 'Neos.Neos:Document'

/**
 * Client-side fallback slug for when the server-side generator is
 * unreachable: strip diacritics (NFD + combining marks), rough
 * ASCII-fication - so the document still gets a URL.
 */
function fallbackSlug(text: string): string {
  const stripped = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  return (
    stripped
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'document'
  )
}

/**
 * Runs one node creation: fetches the node type's schema, shows the
 * ui.creationDialog form when the type configures one (mirroring the classic
 * NodeCreationDialog) and creates the node via the commands API. Types
 * without a creation dialog are created immediately, without any UI.
 *
 * Element values whose name matches a property become initial property
 * values; other elements (classic UI: input to server-side node creation
 * handlers, which the plain CR command path does not run) are ignored.
 */
export function CreateNodeFlow({
  request,
  nodeTypes,
  onCreated,
  onCancel,
}: {
  request: CreateNodeRequest
  nodeTypes: NodeTypeMap | undefined
  /** The node exists; address of the new node. */
  onCreated: (address: string) => void
  /** The user cancelled, or creation failed after the dialog was skipped. */
  onCancel: (error?: string) => void
}) {
  const { data: schema, error: schemaError } = useNodeTypeSchema(
    request.nodeTypeName,
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
    if (!schema) return null
    const configured = schema.configuration.ui?.creationDialog?.elements ?? {}
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
  }, [schema])

  const [values, setValues] = useState<Record<string, unknown>>({})
  // Elements the user has edited: inline errors only show for these, so the
  // dialog does not open with every required field already flagged red - the
  // disabled Create button and the * markers cover the untouched state.
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set())
  // Seed defaults once the schema arrives (elements is null until then): the
  // element's own defaultValue, or the mapped property's - what the CR would
  // apply anyway, but visible and editable before creating.
  useEffect(() => {
    if (elements === null) return
    const properties = schema?.configuration.properties ?? {}
    const defaults: Record<string, unknown> = {}
    for (const element of elements) {
      const defaultValue =
        element.config.defaultValue ?? properties[element.name]?.defaultValue
      if (defaultValue !== undefined) defaults[element.name] = defaultValue
    }
    setValues(defaults)
  }, [elements, schema])

  const typeLabel = humanizeLabel(
    nodeTypes?.get(request.nodeTypeName)?.label,
    request.nodeTypeName.split(':').pop() ?? request.nodeTypeName,
  )

  const submit = async (submittedValues: Record<string, unknown>) => {
    setCreating(true)
    const properties = schema?.configuration.properties ?? {}
    const initialPropertyValues: Record<string, unknown> = {}
    for (const [name, value] of Object.entries(submittedValues)) {
      if (!(name in properties)) continue
      if (value === undefined || value === null || value === '') continue
      initialPropertyValues[name] = value
    }
    try {
      // Documents need a URL from birth: derive uriPathSegment from the
      // entered title (or the type label) with the server's language-aware
      // slug generator - unless a creation-dialog element already set one.
      // The classic UI does the same in its server-side creation handler.
      if (
        nodeTypes !== undefined &&
        isOfType(nodeTypes, request.nodeTypeName, DOCUMENT_SUPER_TYPE) &&
        'uriPathSegment' in properties &&
        initialPropertyValues.uriPathSegment === undefined
      ) {
        const title = initialPropertyValues.title
        const text =
          typeof title === 'string' && title !== '' ? title : typeLabel
        initialPropertyValues.uriPathSegment = await generateUriPathSegment(
          request.parentAddress,
          text,
        ).catch(() => fallbackSlug(text))
      }
      onCreated(await createNode(request, initialPropertyValues))
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

  // No creation dialog configured - create right away (exactly once).
  const autoSubmitted = useRef(false)
  useEffect(() => {
    if (elements === null || elements.length > 0 || autoSubmitted.current)
      return
    autoSubmitted.current = true
    void submit({})
  }, [elements])

  useEffect(() => {
    if (schemaError)
      onCancel(
        schemaError instanceof Error
          ? schemaError.message
          : String(schemaError),
      )
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
                setValues((previous) => ({
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
  const definition = usePropertyEditor(editorId)
  const Editor = definition?.component
  const invalid = errors !== undefined && errors.length > 0

  const control = Editor ? (
    <Editor
      subject={{ name: element.name, type, label: element.label }}
      value={value}
      options={element.config.ui?.editorOptions ?? {}}
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
      <span className="text-xs font-medium text-neutral-400">
        {element.label}
        {element.required && <span className="text-red-500"> *</span>}
      </span>
      {control}
      <ValidationErrors errors={errors} />
    </label>
  )
}
