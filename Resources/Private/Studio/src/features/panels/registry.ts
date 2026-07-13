import type * as React from 'react'
import type { PanelRect } from './geometry'

/**
 * The panel registry: every panel - built-in or third-party - registers here
 * and the panel system renders whatever is registered. Panels register at any
 * time (built-ins before mount, plugins possibly after); the layout
 * re-normalizes when the set changes, so new panels appear at their default
 * placement and panels of unloaded plugins vanish without disturbing the
 * user's arrangement (their stored layout entry is simply dropped).
 */

export type PanelPlacement =
  /** Docked in the sidebar, appended below existing groups. */
  | { kind: 'dock' }
  /** Floating; `rect` is evaluated lazily against the live viewport. */
  | { kind: 'floating'; rect: () => PanelRect }

export type PanelDefinition = {
  /** Unique id, persisted in layouts. Third-party panels should namespace ('vendor.package:panel'). */
  id: string
  /** Tab label. */
  title: string
  /** Panel body. Receives no props - read app state via context (e.g. useStudio()). */
  component: React.ComponentType
  /** Where the panel appears when absent from the stored layout. */
  defaultPlacement: PanelPlacement
}

export class PanelRegistry {
  private definitions = new Map<string, PanelDefinition>()
  private listeners = new Set<() => void>()
  private snapshot: PanelDefinition[] = []

  /** Registering an already-known id replaces it, so HMR and plugin reloads stay idempotent. */
  register(definition: PanelDefinition): void {
    this.definitions.set(definition.id, definition)
    this.emit()
  }

  unregister(id: string): void {
    if (this.definitions.delete(id)) this.emit()
  }

  get(id: string): PanelDefinition | undefined {
    return this.definitions.get(id)
  }

  /** Stable snapshot in registration order - changes identity only on (un)register. */
  getAll(): PanelDefinition[] {
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

export const panelRegistry = new PanelRegistry()
