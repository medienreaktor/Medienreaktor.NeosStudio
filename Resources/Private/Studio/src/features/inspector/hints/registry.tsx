import type { Node } from '@/api/neos/schema'
import { Icon } from '@/components/ui/icon'
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

/**
 * All providers' hints for one property, in their order. A provider that
 * throws is skipped and logged - a broken plugin must not take the inspector
 * down with it.
 */
export function collectPropertyHints(
  node: Node,
  propertyName: string,
  providers: PropertyHintDefinition[],
): PropertyHint[] {
  const hints: PropertyHint[] = []
  for (const provider of providers) {
    try {
      hints.push(...(provider.hints(node, propertyName) ?? []))
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
        <li
          key={index}
          className="flex gap-1.5 type-small text-muted-foreground"
        >
          <Icon
            name={TONE[hint.tone].icon}
            size="s"
            className={cn('mt-0.5 shrink-0', TONE[hint.tone].className)}
          />
          <span>
            {hint.source && (
              <span className="type-small-strong">{hint.source}: </span>
            )}
            {hint.message}
          </span>
        </li>
      ))}
    </ul>
  )
}
