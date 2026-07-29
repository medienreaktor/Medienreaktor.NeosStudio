import * as React from 'react'
import type { Workspace } from '@/api/workspaces'

/**
 * The workspace-decorator registry: plugins visually mark workspaces the shell
 * knows nothing about - a task-workflow package badges its "TASK" branches,
 * a release package its scheduled workspaces, and every surface listing
 * workspaces (switcher, administration, graph) shows the same marks.
 *
 * Decorators are pure data-driven functions over the workspace object: the
 * backend contributes package-specific data via the API's workspace
 * "extensions" object (see WorkspaceDataEnricherInterface in
 * Medienreaktor.NeosApi), and a decorator reads it back out. The shell never
 * learns what a decoration means.
 *
 * Modelled on the other registries (see features/modals/registry.ts): a small
 * observable store, register-replaces-by-id, stable snapshot for
 * useSyncExternalStore.
 */

/** One visual mark a decorator attaches to a workspace. */
export interface WorkspaceDecoration {
  /** Short badge text, e.g. "TASK". Keep it to one word - it renders inline. */
  badge: string
  /** Badge color (any CSS color); defaults to a neutral tone. */
  color?: string
  /** Tooltip / accessible description, e.g. "Task branch, assigned to …". */
  label?: string
  /** Optional Font Awesome icon name (bare, e.g. "clipboard-check") rendered before the badge text. */
  icon?: string
  /**
   * Move the workspace out of the standard entries of the workspace switcher
   * into a dedicated group with this label (e.g. "Tasks & Features").
   * Workspaces sharing the same label share one group; its entries check the
   * workspace out for collaborative editing. Omit to leave the workspace in
   * the standard publish-target/collaborative entries.
   */
  switcherGroup?: string
}

export interface WorkspaceDecoratorDefinition {
  /** Unique id. Third-party entries should namespace ('vendor.package:task'). */
  id: string
  /** Sort weight; lower renders first. Defaults to 100. */
  order?: number
  /**
   * Return the decoration for this workspace, or null for "not applicable".
   * Called during render for every listed workspace - must be cheap and pure
   * (derive from the workspace object, typically its `extensions`).
   */
  decorate: (workspace: Workspace) => WorkspaceDecoration | null
}

export class WorkspaceDecoratorRegistry {
  private definitions = new Map<string, WorkspaceDecoratorDefinition>()
  private listeners = new Set<() => void>()
  private snapshot: WorkspaceDecoratorDefinition[] = []

  /** Registering an already-known id replaces it, so HMR and plugin reloads stay idempotent. */
  register(definition: WorkspaceDecoratorDefinition): void {
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
  getAll(): WorkspaceDecoratorDefinition[] {
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

export const workspaceDecoratorRegistry = new WorkspaceDecoratorRegistry()

/** Subscribe to the decorator registry; re-renders on (un)register. */
export function useWorkspaceDecorators(): WorkspaceDecoratorDefinition[] {
  return React.useSyncExternalStore(
    (onChange) => workspaceDecoratorRegistry.subscribe(onChange),
    () => workspaceDecoratorRegistry.getAll(),
  )
}

/**
 * Evaluate all decorators against one workspace. A decorator that throws is
 * skipped - a broken plugin must not take the workspace UI down with it.
 */
export function decorationsFor(
  workspace: Workspace,
  decorators: WorkspaceDecoratorDefinition[],
): WorkspaceDecoration[] {
  const decorations: WorkspaceDecoration[] = []
  for (const decorator of decorators) {
    try {
      const decoration = decorator.decorate(workspace)
      if (decoration) decorations.push(decoration)
    } catch (error) {
      console.error(
        `Workspace decorator "${decorator.id}" threw and was skipped:`,
        error,
      )
    }
  }
  return decorations
}
