import type * as React from 'react'
import type { Node } from '@/api/neos/schema'
import { ObservableRegistry, useRegistrySelector } from '@/lib/registry'

/**
 * The inspector view registry: read-only widgets that node type configuration
 * places between inspector properties (ui.inspector.views), registered under
 * the view identifier the configuration references (e.g.
 * "Neos.Neos/Inspector/Views/Data/TableView"). Built on the shared observable
 * store (see lib/registry.ts), like the property editor registry:
 * register-replaces-by-id for idempotent HMR and plugin reloads, and a stable
 * snapshot for React - the same seam third-party views plug into.
 */

export interface InspectorViewProps {
  /** The node being inspected. */
  node: Node
  /** Resolved, human-readable label of the view. */
  label: string
  /** The view's configuration - ui.inspector.views.*.viewOptions. */
  options: Record<string, unknown>
}

export type InspectorViewComponent = React.ComponentType<InspectorViewProps>

export interface InspectorViewDefinition {
  /** The view identifier as referenced from node type configuration. */
  id: string
  component: InspectorViewComponent
}

/** Views in registration order; look one up with getDefinition(id) (or get(id)). */
export class InspectorViewRegistry extends ObservableRegistry<InspectorViewDefinition> {}

export const inspectorViewRegistry = new InspectorViewRegistry()

/**
 * Subscribe to the registry and resolve a view definition by id, re-rendering
 * when the registered set changes (a plugin registering a view, HMR).
 */
export function useInspectorView(
  id: string | null | undefined,
): InspectorViewDefinition | undefined {
  // The stored definition object itself - a stable, cached snapshot value.
  return useRegistrySelector(inspectorViewRegistry, (registry) =>
    registry.getDefinition(id),
  )
}
