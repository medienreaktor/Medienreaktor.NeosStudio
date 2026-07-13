import { clampToViewport, type PanelRect } from './geometry'
import type { PanelDefinition } from './registry'

/**
 * The panel layout model: every registered panel lives in exactly one group;
 * a group is either docked in the sidebar (vertical stack) or floating (free
 * rect, array order = z-order, last on top). Panels in a group render as
 * tabs. The whole layout persists to localStorage and is normalized against
 * the registered panel set - on load and whenever the set changes - so
 * unknown panels drop out and missing ones appear at their default
 * placement.
 */

/** A registered panel's id. */
export type PanelId = string

export type PanelGroup = {
  id: string
  panels: PanelId[]
  active: PanelId
  collapsed: boolean
}

export type FloatingGroup = PanelGroup & { rect: PanelRect }

export type PanelLayout = {
  dock: PanelGroup[]
  floating: FloatingGroup[]
}

export type DropTarget =
  /** Join a group as a tab at `index` (Infinity = append). */
  | { kind: 'tabs'; groupId: string; index: number }
  /** Become a new dock group inserted at `index`. */
  | { kind: 'dock-gap'; index: number }
  /** Tear out into a new floating group. */
  | { kind: 'float' }

export type TabDrop = {
  panel: PanelId
  fromGroupId: string
  target: DropTarget
  pointer: { x: number; y: number }
  /** Source group's rect when it floated with only this panel - preserved on re-float. */
  sourceRect: PanelRect | null
}

const DEFAULT_FLOAT_SIZE = { width: 340, height: 440 }

function newGroup(panel: PanelId): PanelGroup {
  return {
    id: crypto.randomUUID(),
    panels: [panel],
    active: panel,
    collapsed: false,
  }
}

export function loadLayout(
  storageKey: string,
  definitions: PanelDefinition[],
): PanelLayout {
  let stored: unknown = null
  try {
    stored = JSON.parse(localStorage.getItem(storageKey) ?? '')
  } catch {
    /* nothing stored or unparsable - the default layout applies */
  }
  return normalizeLayout(stored, definitions)
}

export function saveLayout(storageKey: string, layout: PanelLayout): void {
  localStorage.setItem(storageKey, JSON.stringify(layout))
}

/**
 * Reconcile a stored (or live) layout with the registered panels: drop
 * unregistered and duplicate panels, drop empty groups, repair active tabs
 * and rects, then place registered panels the layout does not contain at
 * their default placement. Accepts arbitrary junk for `stored`.
 */
export function normalizeLayout(
  stored: unknown,
  definitions: PanelDefinition[],
): PanelLayout {
  const known = new Map(definitions.map((d) => [d.id, d]))
  const seenPanels = new Set<PanelId>()
  const usedIds = new Set<string>()
  const s = stored as { dock?: unknown; floating?: unknown } | null

  const sanitizeGroup = (value: unknown): PanelGroup | null => {
    const g = value as Partial<PanelGroup> | null
    const panels = (Array.isArray(g?.panels) ? g.panels : []).filter(
      (p): p is PanelId =>
        typeof p === 'string' && known.has(p) && !seenPanels.has(p),
    )
    if (panels.length === 0) return null
    panels.forEach((p) => seenPanels.add(p))
    const id =
      typeof g?.id === 'string' && !usedIds.has(g.id)
        ? g.id
        : crypto.randomUUID()
    usedIds.add(id)
    return {
      id,
      panels,
      active: panels.includes(g?.active as PanelId)
        ? (g!.active as PanelId)
        : panels[0],
      collapsed: g?.collapsed === true,
    }
  }

  const dock: PanelGroup[] = []
  for (const value of Array.isArray(s?.dock) ? s.dock : []) {
    const group = sanitizeGroup(value)
    if (group) dock.push(group)
  }

  const floating: FloatingGroup[] = []
  for (const value of Array.isArray(s?.floating) ? s.floating : []) {
    const group = sanitizeGroup(value)
    if (!group) continue
    const rect = (value as { rect?: Partial<PanelRect> }).rect
    const valid =
      rect &&
      [rect.x, rect.y, rect.width, rect.height].every((v) => Number.isFinite(v))
    floating.push({
      ...group,
      rect: valid
        ? clampToViewport(rect as PanelRect)
        : clampToViewport({ x: 80, y: 80, ...DEFAULT_FLOAT_SIZE }),
    })
  }

  // Registered panels missing from the layout appear at their default spot,
  // in registration order.
  for (const definition of definitions) {
    if (seenPanels.has(definition.id)) continue
    if (definition.defaultPlacement.kind === 'dock') {
      dock.push(newGroup(definition.id))
    } else {
      floating.push({
        ...newGroup(definition.id),
        rect: clampToViewport(definition.defaultPlacement.rect()),
      })
    }
  }

  return { dock, floating }
}

export function activatePanel(
  layout: PanelLayout,
  groupId: string,
  panel: PanelId,
): PanelLayout {
  const update = <T extends PanelGroup>(g: T): T =>
    g.id === groupId && g.panels.includes(panel) ? { ...g, active: panel } : g
  return {
    dock: layout.dock.map(update),
    floating: layout.floating.map(update),
  }
}

export function toggleCollapsed(
  layout: PanelLayout,
  groupId: string,
): PanelLayout {
  const update = <T extends PanelGroup>(g: T): T =>
    g.id === groupId ? { ...g, collapsed: !g.collapsed } : g
  return {
    dock: layout.dock.map(update),
    floating: layout.floating.map(update),
  }
}

export function setFloatingRect(
  layout: PanelLayout,
  groupId: string,
  rect: PanelRect,
): PanelLayout {
  return {
    ...layout,
    floating: layout.floating.map((g) =>
      g.id === groupId ? { ...g, rect } : g,
    ),
  }
}

export function bringToFront(
  layout: PanelLayout,
  groupId: string,
): PanelLayout {
  const index = layout.floating.findIndex((g) => g.id === groupId)
  if (index < 0 || index === layout.floating.length - 1) return layout
  const floating = [...layout.floating]
  const [group] = floating.splice(index, 1)
  floating.push(group)
  return { ...layout, floating }
}

/** Re-clamp all floating groups, e.g. after a window resize. */
export function clampFloating(layout: PanelLayout): PanelLayout {
  return {
    ...layout,
    floating: layout.floating.map((g) => ({
      ...g,
      rect: clampToViewport(g.rect),
    })),
  }
}

/** Apply a finished tab drag: remove the panel from its group, reinsert per target. */
export function applyDrop(layout: PanelLayout, drop: TabDrop): PanelLayout {
  const { panel, fromGroupId, target, pointer, sourceRect } = drop

  // Remove the panel; empty groups vanish. Track what the removal shifted so
  // indices measured against the pre-drop DOM stay correct.
  let removedTabIndex = -1
  let removedDockGroupIndex = -1
  const strip = <T extends PanelGroup>(g: T): T => {
    if (g.id !== fromGroupId) return g
    removedTabIndex = g.panels.indexOf(panel)
    const panels = g.panels.filter((p) => p !== panel)
    return { ...g, panels, active: g.active === panel ? panels[0] : g.active }
  }
  const dock = layout.dock.map(strip).filter((g, i) => {
    if (g.panels.length > 0) return true
    removedDockGroupIndex = i
    return false
  })
  const floating = layout.floating.map(strip).filter((g) => g.panels.length > 0)

  if (target.kind === 'tabs') {
    const insert = <T extends PanelGroup>(g: T): T => {
      if (g.id !== target.groupId) return g
      let index = Math.min(target.index, g.panels.length)
      // Moving within the same group: the removal shifted later tabs left.
      if (
        g.id === fromGroupId &&
        removedTabIndex >= 0 &&
        removedTabIndex < index
      )
        index -= 1
      const panels = [...g.panels]
      panels.splice(index, 0, panel)
      // Expand so the dropped panel is visible right away.
      return { ...g, panels, active: panel, collapsed: false }
    }
    const next = { dock: dock.map(insert), floating: floating.map(insert) }
    const landed = [...next.dock, ...next.floating].some((g) =>
      g.panels.includes(panel),
    )
    // Target vanished (it was the emptied source group) - treat as a no-op.
    return landed ? next : layout
  }

  if (target.kind === 'dock-gap') {
    let index = Math.min(target.index, dock.length)
    if (removedDockGroupIndex >= 0 && removedDockGroupIndex < index) index -= 1
    const nextDock = [...dock]
    nextDock.splice(index, 0, newGroup(panel))
    return { dock: nextDock, floating }
  }

  // Tear out: keep the size it had when it floated alone, position the tab
  // bar under the pointer, and stack on top.
  const size = sourceRect ?? DEFAULT_FLOAT_SIZE
  const rect = clampToViewport({
    ...size,
    x: pointer.x - 48,
    y: pointer.y - 18,
  })
  return { dock, floating: [...floating, { ...newGroup(panel), rect }] }
}
