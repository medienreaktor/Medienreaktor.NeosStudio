import * as React from 'react'
import type { NodeDto } from '@/api/nodes'

/**
 * The inspector view registry: read-only widgets that node type configuration
 * places between inspector properties (ui.inspector.views), registered under
 * the view identifier the configuration references (e.g.
 * "Neos.Neos/Inspector/Views/Data/TableView"). Modelled on the property
 * editor registry (features/properties/registry.ts): a small observable
 * store, register-replaces-by-id for idempotent HMR and plugin reloads, and a
 * stable snapshot for React - the same seam third-party views plug into.
 */

export interface InspectorViewProps {
  /** The node being inspected. */
  node: NodeDto
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

export class InspectorViewRegistry {
  private definitions = new Map<string, InspectorViewDefinition>()
  private listeners = new Set<() => void>()
  private snapshot: InspectorViewDefinition[] = []

  /** Registering an already-known id replaces it, so HMR and plugin reloads stay idempotent. */
  register(definition: InspectorViewDefinition): void {
    this.definitions.set(definition.id, definition)
    this.emit()
  }

  unregister(id: string): void {
    if (this.definitions.delete(id)) this.emit()
  }

  getDefinition(
    id: string | null | undefined,
  ): InspectorViewDefinition | undefined {
    if (!id) return undefined
    return this.definitions.get(id)
  }

  /** Stable snapshot in registration order - changes identity only on (un)register. */
  getAll(): InspectorViewDefinition[] {
    return this.snapshot
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    this.snapshot = [...this.definitions.values()]
    this.listeners.forEach((listener) => listener())
  }
}

export const inspectorViewRegistry = new InspectorViewRegistry()

/**
 * Subscribe to the registry and resolve a view definition by id, re-rendering
 * when the registered set changes (a plugin registering a view, HMR).
 */
export function useInspectorView(
  id: string | null | undefined,
): InspectorViewDefinition | undefined {
  return React.useSyncExternalStore(
    (onChange) => inspectorViewRegistry.subscribe(onChange),
    () => inspectorViewRegistry.getDefinition(id),
  )
}
