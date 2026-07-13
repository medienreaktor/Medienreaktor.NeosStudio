import { useEffect, useMemo, useRef, useState } from 'react'
import {
  type CreationDialogElementConfig,
  type NodeTypeMap,
  useNodeTypeSchema,
} from '@/api/nodeTypes'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { humanizeLabel } from '@/features/inspector/inspectorSchema'
import { FaIcon, NodeTypeIcon } from '@/features/tree/nodeTypeIcon'
import { sortByPosition } from '@/lib/positional'
import { createNode, type CreateNodeRequest } from './createNode'

const TEXT_AREA_EDITOR = 'Neos.Neos/Inspector/Editors/TextAreaEditor'
const SELECT_BOX_EDITOR = 'Neos.Neos/Inspector/Editors/SelectBoxEditor'
const BOOLEAN_EDITOR = 'Neos.Neos/Inspector/Editors/BooleanEditor'

interface CreationElement {
  name: string
  label: string
  required: boolean
  config: CreationDialogElementConfig
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
  const [error, setError] = useState<string | null>(null)

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

  const submit = async (submittedValues: Record<string, unknown>) => {
    setCreating(true)
    setError(null)
    const properties = schema?.configuration.properties ?? {}
    const initialPropertyValues: Record<string, unknown> = {}
    for (const [name, value] of Object.entries(submittedValues)) {
      if (!(name in properties)) continue
      if (value === undefined || value === null || value === '') continue
      initialPropertyValues[name] = value
    }
    try {
      onCreated(await createNode(request, initialPropertyValues))
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      // With a dialog open the user can retry or cancel; without one the
      // flow is invisible - surface the failure through onCancel.
      if (elements !== null && elements.length > 0) {
        setError(message)
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

  const typeLabel = humanizeLabel(
    nodeTypes?.get(request.nodeTypeName)?.label,
    request.nodeTypeName.split(':').pop() ?? request.nodeTypeName,
  )
  const missingRequired = elements.some((element) => {
    const value = values[element.name]
    return (
      element.required &&
      (value === undefined || value === null || value === '')
    )
  })

  return (
    <Dialog open onOpenChange={(open) => !open && !creating && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <NodeTypeIcon
              nodeTypes={nodeTypes}
              nodeTypeName={request.nodeTypeName}
              className="text-[1rem]"
            />
            Create {typeLabel}
          </DialogTitle>
        </DialogHeader>

        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (!creating && !missingRequired) void submit(values)
          }}
        >
          {elements.map((element, index) => (
            <label key={element.name} className="flex flex-col gap-1.5 text-sm">
              <span className="text-xs font-medium text-muted-foreground">
                {element.label}
                {element.required && (
                  <span className="text-destructive"> *</span>
                )}
              </span>
              <ElementEditor
                element={element}
                autoFocus={index === 0}
                value={values[element.name]}
                onChange={(value) =>
                  setValues((previous) => ({
                    ...previous,
                    [element.name]: value,
                  }))
                }
              />
            </label>
          ))}
        </form>

        {error && (
          <p className="text-sm text-destructive">Creating failed: {error}</p>
        )}

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onCancel()}
            disabled={creating}
          >
            Cancel
          </Button>
          <Button
            onClick={() => void submit(values)}
            disabled={creating || missingRequired}
          >
            {creating ? 'Creating…' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** One selectable option from editorOptions.values. */
interface SelectBoxValueConfig {
  label?: string | null
  icon?: string | null
  position?: string | number
}

/**
 * The editors the creation dialog implements: text field (default), text
 * area, boolean and static select box - covering the typical "title before
 * creating" cases. Unknown editors degrade to a text field.
 */
function ElementEditor({
  element,
  autoFocus = false,
  value,
  onChange,
}: {
  element: CreationElement
  autoFocus?: boolean
  value: unknown
  onChange: (value: unknown) => void
}) {
  const editor = element.config.ui?.editor ?? ''
  const editorOptions = element.config.ui?.editorOptions ?? {}

  if (editor === BOOLEAN_EDITOR || element.config.type === 'boolean') {
    return (
      <input
        type="checkbox"
        className="size-4 self-start accent-primary"
        checked={value === true}
        onChange={(event) => onChange(event.target.checked)}
      />
    )
  }

  if (editor === SELECT_BOX_EDITOR) {
    const valuesConfig = (editorOptions.values ?? {}) as Record<
      string,
      SelectBoxValueConfig | null
    >
    const options = sortByPosition(
      Object.entries(valuesConfig).map(([key, config]) => ({
        key,
        position: config?.position,
      })),
    ).map((key) => ({
      value: key,
      label: humanizeLabel(valuesConfig[key]?.label, key),
      icon: valuesConfig[key]?.icon ?? null,
    }))
    return (
      <Select
        value={typeof value === 'string' ? value : null}
        onValueChange={(next) => onChange(next)}
      >
        <SelectTrigger className="w-full">
          <SelectValue>
            {(current: string | null) =>
              current !== null ? (
                (options.find((option) => option.value === current)?.label ??
                current)
              ) : (
                <span className="text-muted-foreground">–</span>
              )
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.icon && <FaIcon icon={option.icon} />}
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  if (editor === TEXT_AREA_EDITOR) {
    return (
      <Textarea
        autoFocus={autoFocus}
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onChange(event.target.value)}
      />
    )
  }

  return (
    <Input
      autoFocus={autoFocus}
      value={typeof value === 'string' ? value : ''}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}
