import * as React from 'react'

/**
 * The node property editor registry: every editor - built-in or third-party -
 * registers here under the editor identifier that node type configuration
 * references (ui.inspector.editor / ui.editor, e.g.
 * "Neos.Neos/Inspector/Editors/TextFieldEditor"). Both places that edit node
 * properties - the inspector and the node creation dialogs - resolve their
 * controls through this one registry, so an editor written once works in both,
 * and a plugin that registers a custom editor lights up everywhere.
 *
 * Modelled on the panel registry (see features/panels/registry.ts): a small
 * observable store, register-replaces-by-id for idempotent HMR and plugin
 * reloads, and a stable snapshot for React.
 */

/** What an editor is editing: a node property (inspector) or a creation-dialog element. */
export interface PropertyEditorSubject {
  /** Property / element name. */
  name: string
  /** The type from node type configuration, e.g. "string", "integer", "reference". */
  type: string
  /** Resolved, human-readable label. */
  label: string
}

/**
 * The props every property editor receives. Editors own their transient state
 * (a text field keeps what is being typed; the `value` prop only seeds it, so
 * hosts remount on a subject change to reset), and report outward through two
 * callbacks. The split is what lets one editor serve both hosts:
 *
 *  - `onCommit` fires at a natural commit boundary (blur, Enter, a discrete
 *    pick) and carries the value worth keeping. The inspector persists here;
 *    it is the essential signal, so every editor must call it.
 *  - `onChange` fires on every keystroke-level change, before a commit, so a
 *    host tracking a live working copy stays current. The creation dialog
 *    needs this - its required-field validation gates the Create button, which
 *    would otherwise lag a click behind commit-on-blur. Editors with no
 *    distinct editing phase (a checkbox, a select) need only call `onCommit`.
 *
 * The host decides what those mean: the inspector auto-saves on commit, the
 * creation dialog folds every change into the draft it submits on Create. The
 * difference between the hosts lives entirely in the host, never in the editor.
 */
export interface PropertyEditorProps {
  /** The property / element being edited. */
  subject: PropertyEditorSubject
  /** The current value, already unwrapped from any transport envelope. Seeds the editor's state; `undefined` means unset, `null` clears it. */
  value: unknown
  /** Commit a value worth keeping (blur, Enter, a discrete pick). Required - the inspector persists here. */
  onCommit: (value: unknown) => void
  /** Report a live, pre-commit value (per keystroke). Optional - only hosts tracking a working copy (the creation dialog) consume it. */
  onChange?: (value: unknown) => void
  /** The editor's configuration - ui.inspector.editorOptions / ui.editorOptions for this property. */
  options: Record<string, unknown>
  /** Focus on mount; the host sets this for the first field of a form. */
  autoFocus?: boolean
  /**
   * The address of the node being edited, when it already exists (the
   * inspector). Absent in the node creation dialog, where the node does not
   * exist yet. Editors that operate on the node itself - e.g. the node type
   * switcher, which resolves the parent's allowed child types - need it, and
   * degrade gracefully without it.
   */
  nodeAddress?: string
}

export type PropertyEditorComponent = React.ComponentType<PropertyEditorProps>

export interface PropertyEditorDefinition {
  /**
   * The editor identifier as referenced from node type configuration, e.g.
   * "Neos.Neos/Inspector/Editors/TextFieldEditor". Third-party editors should
   * namespace their own ids ('Vendor.Package/Editors/Color').
   */
  id: string
  /** The control. */
  component: PropertyEditorComponent
  /**
   * Whether the editor renders the property label itself - e.g. a checkbox
   * with its label beside it. When true, the host omits its own label and
   * leaves label placement to the editor, which reads subject.label. Defaults
   * to false: the host renders the label above the control.
   */
  rendersOwnLabel?: boolean
}

export class PropertyEditorRegistry {
  private definitions = new Map<string, PropertyEditorDefinition>()
  private listeners = new Set<() => void>()
  private snapshot: PropertyEditorDefinition[] = []

  /** Registering an already-known id replaces it, so HMR and plugin reloads stay idempotent. */
  register(definition: PropertyEditorDefinition): void {
    this.definitions.set(definition.id, definition)
    this.emit()
  }

  unregister(id: string): void {
    if (this.definitions.delete(id)) this.emit()
  }

  /** The component registered for an editor id, or undefined - the host renders a read-only fallback for unknown editors. */
  get(id: string | null | undefined): PropertyEditorComponent | undefined {
    return this.getDefinition(id)?.component
  }

  /** The full definition for an editor id (component + metadata), or undefined. */
  getDefinition(
    id: string | null | undefined,
  ): PropertyEditorDefinition | undefined {
    if (!id) return undefined
    return this.definitions.get(id)
  }

  /** Stable snapshot in registration order - changes identity only on (un)register. */
  getAll(): PropertyEditorDefinition[] {
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

export const propertyEditorRegistry = new PropertyEditorRegistry()

/**
 * Subscribe to the registry and resolve an editor definition by id,
 * re-rendering when the registered set changes (a plugin registering an editor,
 * HMR). The two hosts share this hook so neither has to reimplement the
 * subscription; each reads `.component` and `.rendersOwnLabel` off the result.
 */
export function usePropertyEditor(
  id: string | null | undefined,
): PropertyEditorDefinition | undefined {
  return React.useSyncExternalStore(
    (onChange) => propertyEditorRegistry.subscribe(onChange),
    () => propertyEditorRegistry.getDefinition(id),
  )
}
