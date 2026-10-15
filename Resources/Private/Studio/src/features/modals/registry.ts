import type * as React from 'react'
import {
  ObservableRegistry,
  type RegistryEntry,
  useRegistry,
} from '@/lib/registry'

/**
 * The settings-dialog registry: Studio replaces the classic Neos backend
 * modules with large, near-screen-filling modal dialogs.
 *
 * The {@link settingsDialogRegistry} holds *settings sections*. They all share
 * one Settings modal whose left-hand subnavigation lists every registered
 * section (users, sites, workspaces, ...); picking one renders it in the modal
 * body. Built-ins and third-party plugins register the same way.
 *
 * Like every Studio registry it builds on the shared observable store (see
 * lib/registry.ts): register-replaces-by-id so HMR and plugin reloads stay
 * idempotent, and a stable snapshot for React's useSyncExternalStore.
 */

/** The minimum every registered definition provides: a unique, stable id. */
interface RegistryDefinition extends RegistryEntry {
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
 * The shared observable, id-keyed store (see {@link ObservableRegistry}),
 * with its getAll() snapshot sorted by `order` then registration order.
 */
export class ModalRegistry<
  Def extends RegistryDefinition,
> extends ObservableRegistry<Def> {
  constructor() {
    super({ sort: 'order' })
  }
}

/** Icon type for a settings section - a bare Font Awesome name (e.g. "users"), resolved via faClassName. */
export type ModalIcon = string

/**
 * A settings section: one entry in the shared Settings modal's subnavigation
 * (users, sites, workspaces, ...).
 */
export interface SettingsDialogDefinition extends RegistryDefinition {
  /** Label shown in the settings subnavigation and section header. */
  title: string
  /** Optional subnav icon. */
  icon?: ModalIcon
  /**
   * Visual grouping in the subnavigation: a separator is drawn between
   * adjacent sections whose groups differ. Sorting stays purely order-based,
   * so keep a group's sections contiguous via their `order`. Omitting the
   * group puts a section in the default (unnamed) group.
   */
  group?: string
  /** The section body. Propless - reads app state via context, like a settings screen. */
  component: React.ComponentType
  /**
   * A hook deciding whether this section is reachable right now (e.g. a
   * permission check reading useAdministrationPermissions()). When it returns false the section still
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
  return useRegistry(settingsDialogRegistry)
}
