import type * as React from 'react'
import { ObservableRegistry } from '@/lib/registry'
import type { PanelRect } from './geometry'
import type { DockRegion } from './panelLayout'

/**
 * The panel registry: every panel - built-in or third-party - registers here
 * and the panel system renders whatever is registered. Panels register at any
 * time (built-ins before mount, plugins possibly after); the layout
 * re-normalizes when the set changes, so new panels appear at their default
 * placement and panels of unloaded plugins vanish without disturbing the
 * user's arrangement (their stored layout entry is simply dropped).
 */

export type PanelPlacement =
  /**
   * Docked in a region (sidebar/main/secondary), appended below existing
   * groups. Panels sharing a `group` key join one group (as tabs) instead of
   * each opening their own - including a group its siblings already occupy in
   * a stored layout, so a panel added later lands next to them rather than in
   * a new group of its own.
   */
  | { kind: 'dock'; region: DockRegion; group?: string }
  /** Floating; `rect` is evaluated lazily against the live viewport. */
  | { kind: 'floating'; rect: () => PanelRect }

export type PanelDefinition = {
  /** Unique id, persisted in layouts. Third-party panels should namespace ('vendor.package:panel'). */
  id: string
  /**
   * Tab label - or a function returning it, resolved whenever the label is
   * rendered (read it through {@link panelTitle}), so a translated label
   * follows the bundle instead of freezing at registration time.
   */
  title: string | (() => string)
  /** Panel body. Receives no props - read app state via context (e.g. useStudio()). */
  component: React.ComponentType
  /** Where the panel appears when absent from the stored layout. */
  defaultPlacement: PanelPlacement
}

/** A panel's current tab label. */
export function panelTitle(definition: Pick<PanelDefinition, 'title'>): string {
  return typeof definition.title === 'function'
    ? definition.title()
    : definition.title
}

/**
 * Panels in registration order. The observable store itself (register-
 * replaces-by-id, stable getAll() snapshot, bound subscribe) lives in
 * {@link ObservableRegistry}.
 */
export class PanelRegistry extends ObservableRegistry<PanelDefinition> {}

export const panelRegistry = new PanelRegistry()
