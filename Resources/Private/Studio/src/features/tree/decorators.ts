import * as React from 'react'
import type { NodeDto } from '@/api/nodes'
import type { NodeTypeMap } from '@/api/nodeTypes'

/**
 * The node-decorator registry: how tree rows (document tree, content
 * outliner, search results, document pickers) get their type icon and their
 * state visuals. A decorator maps a node to a decoration - swap the icon,
 * layer a small badge onto its corner, tint or dim the whole row - and every
 * surface listing nodes shows the same marks.
 *
 * The shell's own visuals go through this seam too (see
 * registerBuiltinNodeDecorators in builtinDecorators.ts): the configured
 * ui.icon, the dimming of hidden / hidden-in-menu nodes, the red badges for
 * explicitly hidden and deleted nodes. A plugin registers exactly the same
 * way for its own concerns - a lock overlay on access-restricted pages, a
 * tint for nodes in a review state, whatever its package knows about.
 *
 * Modelled on the other registries (see features/workspaces/decorators.ts):
 * a small observable store, register-replaces-by-id, stable snapshot for
 * useSyncExternalStore.
 */

/** A small badge layered onto a corner of the node's type icon. */
export interface NodeDecorationOverlay {
  /** Font Awesome icon name, any syntax `ui.icon` accepts (e.g. "circle-xmark"). */
  icon: string
  /** Badge color (any CSS color, preferably a theme variable like 'var(--color-red-500)'); defaults to red. */
  color?: string
  /** Tooltip / accessible description, e.g. "Deleted". */
  label?: string
  /** Icon corner the badge sits on. Defaults to 'bottom-right'. */
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
}

/** The visual contribution of one decorator to one node's row. */
export interface NodeDecoration {
  /**
   * Replace the row's type icon - a Font Awesome name, any syntax `ui.icon`
   * accepts. Decorators run in `order`; the last one to set an icon wins, so
   * a plugin (default order 100) overrides the built-in type icon (order 0).
   */
  icon?: string
  /** Badge layered onto the icon. Overlays from all decorators accumulate. */
  overlay?: NodeDecorationOverlay
  /** Text color for the whole row (icon + label) - any CSS color. Last one wins. */
  color?: string
  /** Opacity for the whole row (icon + label), 0..1. The lowest contributed value wins. */
  opacity?: number
  /** Tooltip line for the row's icon. Lines from all decorators stack. */
  title?: string
}

/** What a decorator gets to look at besides the node itself. */
export interface NodeDecorationContext {
  /** The node type map, once loaded - for icon/type lookups. */
  nodeTypes: NodeTypeMap | undefined
}

export interface NodeDecoratorDefinition {
  /** Unique id. Third-party entries should namespace ('vendor.package:lock'). */
  id: string
  /** Sort weight; lower runs first (and gets overridden by later ones). Defaults to 100. */
  order?: number
  /**
   * Return the decoration for this node, or null for "not applicable".
   * Called during render for every visible row - must be cheap and pure
   * (derive from the node object: tags, properties, nodeType).
   */
  decorate: (
    node: NodeDto,
    context: NodeDecorationContext,
  ) => NodeDecoration | null
}

export class NodeDecoratorRegistry {
  private definitions = new Map<string, NodeDecoratorDefinition>()
  private listeners = new Set<() => void>()
  private snapshot: NodeDecoratorDefinition[] = []

  /** Registering an already-known id replaces it, so HMR and plugin reloads stay idempotent. */
  register(definition: NodeDecoratorDefinition): void {
    this.definitions.set(definition.id, definition)
    this.emit()
  }

  unregister(id: string): void {
    if (this.definitions.delete(id)) this.emit()
  }

  /**
   * Stable snapshot sorted by `order` then registration order - changes
   * identity only on (un)register, so useSyncExternalStore stays quiet.
   */
  getAll(): NodeDecoratorDefinition[] {
    return this.snapshot
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    this.snapshot = [...this.definitions.values()].sort(
      (a, b) => (a.order ?? 100) - (b.order ?? 100),
    )
    this.listeners.forEach((listener) => listener())
  }
}

export const nodeDecoratorRegistry = new NodeDecoratorRegistry()

/** Subscribe to the decorator registry; re-renders on (un)register. */
export function useNodeDecorators(): NodeDecoratorDefinition[] {
  return React.useSyncExternalStore(
    (onChange) => nodeDecoratorRegistry.subscribe(onChange),
    () => nodeDecoratorRegistry.getAll(),
  )
}

/** All decorators' contributions to one node, folded per the field rules above. */
export interface MergedNodeDecoration {
  icon?: string
  overlays: NodeDecorationOverlay[]
  color?: string
  opacity?: number
  titles: string[]
}

/**
 * Evaluate all decorators against one node and fold the decorations:
 * icon and color last-wins, opacity lowest-wins, overlays and title lines
 * accumulate. A decorator that throws is skipped - a broken plugin must not
 * take the trees down with it.
 */
export function mergeNodeDecorations(
  node: NodeDto,
  context: NodeDecorationContext,
  decorators: NodeDecoratorDefinition[],
): MergedNodeDecoration {
  const merged: MergedNodeDecoration = { overlays: [], titles: [] }
  for (const decorator of decorators) {
    try {
      const decoration = decorator.decorate(node, context)
      if (!decoration) continue
      if (decoration.icon !== undefined) merged.icon = decoration.icon
      if (decoration.overlay) merged.overlays.push(decoration.overlay)
      if (decoration.color !== undefined) merged.color = decoration.color
      if (decoration.opacity !== undefined)
        merged.opacity = Math.min(
          merged.opacity ?? decoration.opacity,
          decoration.opacity,
        )
      if (decoration.title) merged.titles.push(decoration.title)
    } catch (error) {
      console.error(
        `Node decorator "${decorator.id}" threw and was skipped:`,
        error,
      )
    }
  }
  return merged
}
