import { type Node, nodeAddressKey } from '@/api/neos/schema'
import {
  useStudio,
  useStudioActions,
  type StudioActions,
} from '@/app/StudioContext'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Spinner } from '@/components/ui/spinner'
import { runAction, useActionBusy } from '@/features/actions/registry'
import { labelOf, type LazyLabel } from '@/lib/observableRegistry'
import { ObservableRegistry, useRegistry } from '@/lib/registry'

/**
 * The property-action registry: buttons a plugin adds under a property's field
 * in the inspector, whatever editor the property has - "Generate" a text with
 * a model, look a value up, fill it from somewhere else. The field stays
 * Studio's (or the configured editor's); the action only reads and writes its
 * value. A plugin no longer has to replace an editor to put a button under it.
 *
 * Built on the shared observable store (see lib/registry.ts), like the property
 * hints: register-replaces-by-id, a stable snapshot, refresh() for actions
 * whose `when` depends on the plugin's own data.
 */

/** The property an action is asked about, as its node type configures it. */
export interface PropertyActionProperty {
  name: string
  /** The property type, e.g. "string". */
  type: string
  label: string
  /** The editor configured for it, e.g. "Neos.Neos/Inspector/Editors/TextAreaEditor". */
  editor: string | null
  /** ui.inspector.editorOptions - a plugin's own options can live here. */
  editorOptions: Record<string, unknown>
}

/** What `when` gets to decide whether an action is offered. */
export interface PropertyActionContext {
  node: Node
  property: PropertyActionProperty
}

/** What `run` gets: the field's value, and the way to change it. */
export interface PropertyActionRunContext extends PropertyActionContext {
  /** The field's value now, including what was typed and not saved yet. */
  value: unknown
  /**
   * Save a value for the property, as if the editor committed it, and show it
   * in the field - an unsaved draft there is replaced.
   */
  setValue: (value: unknown) => void
  /** The document shown in the preview, e.g. for context about the node. */
  document: Node | null
  /** The shell's actions, as node actions get them. */
  studio: StudioActions
}

/** A button under a field. Shared by property actions and hint actions. */
export interface ActionButtonConfig {
  /** The button's text, e.g. "Generate" - an ellipsis when it asks for more. */
  label: LazyLabel
  /** A Font Awesome icon name, any syntax `ui.icon` accepts. */
  icon?: string
}

export interface PropertyActionDefinition extends ActionButtonConfig {
  /** Unique id. Third-party entries should namespace ('vendor.package:generate'). */
  id: string
  /** Sort weight; lower first. Defaults to 100. */
  order?: number
  /**
   * Whether the action is offered for this property of this node. Called
   * while the inspector renders, for every property it shows - keep it cheap
   * and synchronous. A read-only or disabled property gets no actions anyway.
   */
  when: (context: PropertyActionContext) => boolean
  /**
   * What clicking does. A returned promise keeps the button busy until it
   * settles; a throw or a rejection ends as an error toast titled with the
   * label, as for node actions.
   */
  run: (context: PropertyActionRunContext) => void | Promise<unknown>
}

export class PropertyActionRegistry extends ObservableRegistry<PropertyActionDefinition> {
  constructor() {
    super({ sort: 'order' })
  }

  /** Re-emit without a registration change: what `when` depends on changed. */
  refresh(): void {
    this.emit()
  }
}

export const propertyActionRegistry = new PropertyActionRegistry()

/**
 * The buttons of the actions offered for one property, under its field;
 * nothing when there are none. An action that throws in `when` is skipped and
 * logged.
 */
export function PropertyActions({
  node,
  property,
  value,
  onSave,
}: {
  node: Node
  property: PropertyActionProperty
  value: unknown
  /** Saves and reseeds the field: the host's commit plus an editor reset. */
  onSave: (value: unknown) => void
}) {
  const actions = useRegistry(propertyActionRegistry)
  const { selectedDocument } = useStudio()
  const studio = useStudioActions()
  if (actions.length === 0) return null
  const readOnly =
    property.editorOptions.readonly === true ||
    property.editorOptions.disabled === true
  if (readOnly) return null
  const offered = actions.filter((action) => {
    try {
      return action.when({ node, property })
    } catch (error) {
      console.error(
        `Property action "${action.id}" threw in when() and was skipped:`,
        error,
      )
      return false
    }
  })
  if (offered.length === 0) return null
  return (
    <div
      className="mt-1.5 flex flex-wrap gap-1.5"
      data-property-actions={property.name}
    >
      {offered.map((action) => (
        <ActionButton
          key={action.id}
          id={action.id}
          config={action}
          busyKey={`property ${action.id} ${nodeAddressKey(node)} ${property.name}`}
          run={() =>
            action.run({
              node,
              property,
              value,
              setValue: onSave,
              document: selectedDocument,
              studio,
            })
          }
        />
      ))}
    </div>
  )
}

/**
 * The button of a property or hint action: outlined, size sm, the icon before
 * the label, a spinner instead of it while the run is pending. Runs through
 * runAction, so errors and busy state behave as for node actions.
 */
export function ActionButton({
  id,
  config,
  busyKey,
  run,
}: {
  id: string
  config: ActionButtonConfig
  busyKey: string
  run: () => void | Promise<unknown>
}) {
  const busy = useActionBusy(busyKey)
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={busy}
      onClick={() =>
        runAction({ id, label: config.label }, busyKey, () =>
          Promise.resolve(run()).then(() => undefined),
        )
      }
    >
      {busy ? <Spinner /> : config.icon && <Icon name={config.icon} size="s" />}
      {labelOf(config.label)}
    </Button>
  )
}
