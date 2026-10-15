import type * as React from 'react'
import type { Workspace } from '@/api/neos/schema'
import { ObservableRegistry, useRegistry } from '@/lib/registry'

/**
 * The workspace-decorator registry: plugins visually mark workspaces the shell
 * knows nothing about - a task-workflow package badges its "TASK" branches,
 * a release package its scheduled workspaces, and every surface listing
 * workspaces (switcher, administration, graph) shows the same marks.
 *
 * Decorators are pure functions over the workspace object (Neos.Api's
 * Workspace). Data beyond it - a package's own records about a workspace -
 * is the decorator's business: it keeps a module-level snapshot of what it
 * needs (fed by a hook of its feature, looked up by workspace name) and calls
 * workspaceDecoratorRegistry.refresh() when that snapshot changes, so every
 * workspace listing re-renders (see features/tasks/decorationData.ts). The
 * shell never learns what a decoration means.
 *
 * Built on the shared observable store (see lib/registry.ts), like the
 * other registries: register-replaces-by-id, stable snapshot for
 * useSyncExternalStore, plus refresh() for decorators whose own data
 * changed.
 */

/** One visual mark a decorator attaches to a workspace. */
export interface WorkspaceDecoration {
  /** Short badge text, e.g. "TASK". Keep it to one word - it renders inline. */
  badge: string
  /** Badge color (any CSS color, preferably a styles.css theme variable like 'var(--color-blue-500)'); defaults to a neutral tone. */
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

/**
 * What a decorator adds to the workspace switcher: workflow actions for the
 * checked-out workspace it decorates (a task's send to review, complete,
 * reopen) and entries of its own (e.g. "Add task workspace"). The switcher
 * renders them without knowing what they do.
 */
export interface WorkspaceSwitcherExtension {
  /**
   * Wraps the switcher while it is mounted: the state and dialogs of the
   * menu items below, which reach it through the decorator's own context. A
   * menu unmounts its items when it closes, so a dialog they open must live
   * here.
   */
  Provider?: React.ComponentType<{
    /** The workspace being edited. */
    activeWorkspace: Workspace
    /** Checks a workspace out for editing, e.g. a freshly created one. */
    onCheckout: (workspaceName: string) => void
    children: React.ReactNode
  }>
  /**
   * The checked-out workspace's actions (menu items), nested as the submenu
   * of its entry - for a workspace this decorator decorates.
   */
  Actions?: React.ComponentType<{ workspace: Workspace }>
  /** Menu items at the end of the switcher's menu. */
  MenuItems?: React.ComponentType
}

export interface WorkspaceDecoratorDefinition {
  /** Unique id. Third-party entries should namespace ('vendor.package:task'). */
  id: string
  /** Sort weight; lower renders first. Defaults to 100. */
  order?: number
  /**
   * Return the decoration for this workspace, or null for "not applicable".
   * Called during render for every listed workspace - must be cheap and pure
   * (derive from the workspace object plus the decorator's own snapshot,
   * looked up by `workspace.name`).
   */
  decorate: (workspace: Workspace) => WorkspaceDecoration | null
  /** What the decorator adds to the workspace switcher. */
  switcher?: WorkspaceSwitcherExtension
}

/**
 * Decorators sorted by `order` then registration order - the getAll()
 * snapshot changes identity only on (un)register and refresh(), so
 * useSyncExternalStore stays quiet otherwise.
 */
export class WorkspaceDecoratorRegistry extends ObservableRegistry<WorkspaceDecoratorDefinition> {
  constructor() {
    super({ sort: 'order' })
  }

  /**
   * Re-emit without a registration change: a decorator's own data changed
   * (e.g. the task list), so its decorations did. Rebuilds the snapshot, which
   * makes useSyncExternalStore consumers re-render and decorate again.
   */
  refresh(): void {
    this.emit()
  }
}

export const workspaceDecoratorRegistry = new WorkspaceDecoratorRegistry()

/** Subscribe to the decorator registry; re-renders on (un)register and refresh(). */
export function useWorkspaceDecorators(): WorkspaceDecoratorDefinition[] {
  return useRegistry(workspaceDecoratorRegistry)
}

/** The decorator's decoration; null when it throws (logged, skipped). */
function safeDecorate(
  decorator: WorkspaceDecoratorDefinition,
  workspace: Workspace,
): WorkspaceDecoration | null {
  try {
    return decorator.decorate(workspace)
  } catch (error) {
    console.error(
      `Workspace decorator "${decorator.id}" threw and was skipped:`,
      error,
    )
    return null
  }
}

/**
 * Evaluate all decorators against one workspace. A decorator that throws is
 * skipped - a broken plugin must not take the workspace UI down with it.
 */
export function decorationsFor(
  workspace: Workspace,
  decorators: WorkspaceDecoratorDefinition[],
): WorkspaceDecoration[] {
  return decorators.flatMap((decorator) => {
    const decoration = safeDecorate(decorator, workspace)
    return decoration ? [decoration] : []
  })
}

/**
 * The switcher actions for the workspace: of the first decorator that
 * decorates it and has actions, null for none.
 */
export function switcherActionsFor(
  workspace: Workspace,
  decorators: WorkspaceDecoratorDefinition[],
): React.ComponentType<{ workspace: Workspace }> | null {
  const decorator = decorators.find(
    (candidate) =>
      candidate.switcher?.Actions !== undefined &&
      safeDecorate(candidate, workspace) !== null,
  )
  return decorator?.switcher?.Actions ?? null
}
