import { type Node, nodeAddressKey } from '@/api/neos/schema'
import { Icon } from '@/components/ui/icon'
import {
  ActionButton,
  type ActionButtonConfig,
} from '@/features/inspector/actions/registry'
import { ObservableRegistry, useRegistry } from '@/lib/registry'
import { cn } from '@/lib/utils'

/**
 * The property-hint registry: notes a plugin shows under a property's field in
 * the inspector - a finding of a content check, a reminder from an editorial
 * workflow, a value that is about to expire. A hint informs and nothing more:
 * unlike a validator it neither marks the field invalid nor holds up saving,
 * and it needs no node type configuration - it is asked about every property
 * of every node.
 *
 * Built on the shared observable store (see lib/registry.ts), like the node
 * decorators: register-replaces-by-id, a stable snapshot, and refresh() for
 * providers whose own data changed.
 */

export type PropertyHintTone = 'info' | 'warning' | 'error'

/** One note under a field. */
export interface PropertyHint {
  /** The color and icon: info (neutral), warning (orange), error (red). Not a validation error either way. */
  tone: PropertyHintTone
  /** What to say, one sentence or two. */
  message: string
  /** Who says it, shown before the message when given, e.g. "Content audit". */
  source?: string
  /**
   * Something to do about it, shown as a button under the message - mark a
   * finding as an exception, open the rule's explanation. Optional; a hint
   * without one only informs.
   */
  action?: PropertyHintAction
}

/** The button under a hint's message. */
export interface PropertyHintAction extends ActionButtonConfig {
  /**
   * What clicking it does. A returned promise keeps the button busy until it
   * settles; a throw or a rejection ends as an error toast titled with the
   * label, as for node actions. To ask for something first, open a dialog
   * (`dialogs.open`) and return its `result`. When done, refresh the hints
   * whose data changed (`propertyHints.refresh()`).
   */
  run: () => void | Promise<unknown>
}

export interface PropertyHintDefinition {
  /** Unique id. Third-party entries should namespace ('vendor.package:findings'). */
  id: string
  /** Sort weight; lower first. Defaults to 100. */
  order?: number
  /**
   * The hints for one property of a node, or null for none. Called while the
   * inspector renders, for every property it shows - must be cheap and
   * synchronous: answer from data at hand, fetch elsewhere and refresh().
   */
  hints: (node: Node, propertyName: string) => PropertyHint[] | null
}

export class PropertyHintRegistry extends ObservableRegistry<PropertyHintDefinition> {
  constructor() {
    super({ sort: 'order' })
  }

  /**
   * Re-emit without a registration change: a provider's own data changed (a
   * check finished, an edit made a finding go), so its hints did. The
   * inspector renders them anew.
   */
  refresh(): void {
    this.emit()
  }
}

export const propertyHintRegistry = new PropertyHintRegistry()

/** A hint with the provider that gave it. */
export type CollectedPropertyHint = PropertyHint & { provider: string }

/**
 * All providers' hints for one property, in their order. A provider that
 * throws is skipped and logged - a broken plugin must not take the inspector
 * down with it.
 */
export function collectPropertyHints(
  node: Node,
  propertyName: string,
  providers: PropertyHintDefinition[],
): CollectedPropertyHint[] {
  const hints: CollectedPropertyHint[] = []
  for (const provider of providers) {
    try {
      for (const hint of provider.hints(node, propertyName) ?? []) {
        hints.push({ ...hint, provider: provider.id })
      }
    } catch (error) {
      console.error(
        `Property hint provider "${provider.id}" threw and was skipped:`,
        error,
      )
    }
  }
  return hints
}

const TONE = {
  info: { icon: 'circle-info', className: 'text-muted-foreground' },
  warning: { icon: 'triangle-exclamation', className: 'text-warning-text' },
  error: { icon: 'circle-exclamation', className: 'text-destructive-text' },
} as const

/** The hints under one property's field; nothing when there are none. */
export function PropertyHints({
  node,
  propertyName,
}: {
  node: Node
  propertyName: string
}) {
  const providers = useRegistry(propertyHintRegistry)
  if (providers.length === 0) return null
  const hints = collectPropertyHints(node, propertyName, providers)
  if (hints.length === 0) return null
  return (
    <ul className="mt-1.5 space-y-1" data-property-hints={propertyName}>
      {hints.map((hint, index) => (
        // Two columns: the icon, centred on the message's line(s), and the
        // message; the action below the message, in its column.
        <li
          key={index}
          className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-1.5 gap-y-1 type-small text-muted-foreground"
        >
          <Icon
            name={TONE[hint.tone].icon}
            size="s"
            className={cn('justify-self-center', TONE[hint.tone].className)}
          />
          <span>
            {hint.source && (
              <span className="type-small-strong">{hint.source}: </span>
            )}
            {hint.message}
          </span>
          {hint.action && (
            <span className="col-start-2">
              <ActionButton
                id={hint.provider}
                config={hint.action}
                busyKey={`hint ${hint.provider} ${nodeAddressKey(node)} ${propertyName} ${index}`}
                run={hint.action.run}
                size="xs"
              />
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}
