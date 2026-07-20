import * as React from 'react'

/**
 * The settings-dialog registry: Studio replaces the classic Neos backend
 * modules with large, near-screen-filling modal dialogs.
 *
 * The {@link settingsDialogRegistry} holds *settings sections*. They all share
 * one Settings modal whose left-hand subnavigation lists every registered
 * section (users, sites, workspaces, ...); picking one renders it in the modal
 * body. Built-ins and third-party plugins register the same way.
 *
 * It is modelled on the panel and property-editor registries (see
 * features/panels/registry.ts and features/inspector/editors/registry.ts): a small
 * observable store, register-replaces-by-id so HMR and plugin reloads stay
 * idempotent, and a stable snapshot for React's useSyncExternalStore.
 */

/** The minimum every registered definition provides: a unique, stable id. */
interface RegistryDefinition {
  /** Unique id. Third-party entries should namespace ('vendor.package:media'). */
  id: string
  /**
   * Sort weight for listings (module launchers, the settings subnav). Lower
   * comes first; entries with the same order keep registration order. Defaults
   * to 100, leaving room for built-ins to sit before or after plugins.
   */
  order?: number
}

/**
 * A small observable, id-keyed store, shaped exactly like the
 * panel/property-editor registries so consumers reuse the same subscribe +
 * snapshot pattern.
 */
class ModalRegistry<Def extends RegistryDefinition> {
  private definitions = new Map<string, Def>()
  private listeners = new Set<() => void>()
  private snapshot: Def[] = []

  /** Registering an already-known id replaces it, so HMR and plugin reloads stay idempotent. */
  register(definition: Def): void {
    this.definitions.set(definition.id, definition)
    this.emit()
  }

  unregister(id: string): void {
    if (this.definitions.delete(id)) this.emit()
  }

  get(id: string | null | undefined): Def | undefined {
    if (!id) return undefined
    return this.definitions.get(id)
  }

  /**
   * Stable snapshot sorted by `order` then registration order - changes
   * identity only on (un)register, so useSyncExternalStore stays quiet.
   */
  getAll(): Def[] {
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

/** Icon type for a settings section - matches lucide-react icon components. */
export type ModalIcon = React.ComponentType<{ className?: string }>

/**
 * A settings section: one entry in the shared Settings modal's subnavigation
 * (users, sites, workspaces, ...).
 */
export interface SettingsDialogDefinition extends RegistryDefinition {
  /** Label shown in the settings subnavigation and section header. */
  title: string
  /** Optional subnav icon. */
  icon?: ModalIcon
  /** The section body. Propless - reads app state via context, like a settings screen. */
  component: React.ComponentType
  /**
   * A hook deciding whether this section is reachable right now (e.g. a
   * permission check reading useMe()). When it returns false the section still
   * appears in the subnavigation but disabled and unclickable - the host keeps
   * it visible so users see the capability exists. Omit for always-enabled.
   *
   * It is a hook: the host calls it from a component dedicated to this section
   * (one per subnav entry, and a remounted one for the body), so calling other
   * hooks inside stays within the rules of hooks.
   */
  useEnabled?: () => boolean
  /** Tooltip shown on the disabled subnav entry, e.g. "Administrators only". */
  disabledReason?: string
}

export const settingsDialogRegistry =
  new ModalRegistry<SettingsDialogDefinition>()

/** Subscribe to the settings-section registry; re-renders on (un)register. */
export function useSettingsDialogs(): SettingsDialogDefinition[] {
  return React.useSyncExternalStore(
    (onChange) => settingsDialogRegistry.subscribe(onChange),
    () => settingsDialogRegistry.getAll(),
  )
}
