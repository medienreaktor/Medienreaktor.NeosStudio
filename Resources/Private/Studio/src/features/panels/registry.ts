import * as React from 'react'
import { ObservableRegistry, labelOf } from '@/lib/registry'
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
  /**
   * Floating; `rect` is evaluated lazily against the live viewport and
   * answers in px, which the panel system converts to its rem rects.
   */
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
  /**
   * A count on the panel's tab, to draw attention to what the panel has to
   * say: findings, unread messages, open tasks. Asked whenever the tab
   * renders - keep it cheap and synchronous - and again after
   * {@link PanelRegistry.refresh}. Null, or a count of 0, for none.
   */
  badge?: () => PanelBadge | null
}

/** A count bubble on a panel's tab. */
export interface PanelBadge {
  count: number
  /** alert (red, the default), warning (orange) or neutral. */
  tone?: 'alert' | 'warning' | 'neutral'
  /** Tooltip and accessible description, e.g. "3 warnings". */
  label?: string
}

/** A panel's current tab label. */
export function panelTitle(definition: Pick<PanelDefinition, 'title'>): string {
  return labelOf(definition.title)
}

/**
 * Panels in registration order. The observable store itself (register-
 * replaces-by-id, stable getAll() snapshot, bound subscribe) lives in
 * {@link ObservableRegistry}.
 */
export class PanelRegistry extends ObservableRegistry<PanelDefinition> {
  private badgeListeners = new Set<() => void>()
  private badgeVersion = 0

  /**
   * Ask every panel for its badge again: a panel's own data changed. Only the
   * tabs re-render - the layout is left alone.
   */
  refresh(): void {
    this.badgeVersion++
    for (const listener of this.badgeListeners) listener()
  }

  /** @internal Subscribes a tab to {@link refresh}. */
  subscribeBadges = (listener: () => void): (() => void) => {
    this.badgeListeners.add(listener)
    return () => this.badgeListeners.delete(listener)
  }

  /** @internal Changes with every {@link refresh}. */
  badgesVersion = (): number => this.badgeVersion
}

export const panelRegistry = new PanelRegistry()

/**
 * A panel's badge, re-read after every refresh(). A badge function that throws
 * is logged and shows nothing - a broken plugin must not take the tabs down.
 */
export function usePanelBadge(
  definition: PanelDefinition | undefined,
): PanelBadge | null {
  React.useSyncExternalStore(
    panelRegistry.subscribeBadges,
    panelRegistry.badgesVersion,
  )
  if (!definition?.badge) return null
  try {
    const badge = definition.badge()
    return badge && badge.count > 0 ? badge : null
  } catch (error) {
    console.error(`Badge of panel "${definition.id}" threw:`, error)
    return null
  }
}
