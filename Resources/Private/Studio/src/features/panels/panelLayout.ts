import { clampToViewport, type PanelRect } from './geometry'
import type { PanelDefinition } from './registry'

/**
 * The panel layout model: every registered panel lives in exactly one group;
 * a group is either docked in one of the dock regions (a vertical stack) or
 * floating (free rect, array order = z-order, last on top). Panels in a group
 * render as tabs. The whole layout persists to localStorage and is normalized
 * against the registered panel set - on load and whenever the set changes - so
 * unknown panels drop out and missing ones appear at their default placement.
 */

/** A registered panel's id. */
export type PanelId = string

/**
 * The docked homes a group can occupy: the left `sidebar`, the big center
 * `main` area, and the optional right `secondary` sidebar. Each is an
 * independent vertical stack of groups.
 */
export type DockRegion = 'sidebar' | 'main' | 'secondary'
export const DOCK_REGIONS: DockRegion[] = ['sidebar', 'main', 'secondary']

/**
 * Regions rendered as a single tab group: they never split or stack, so any
 * groups they hold coalesce into one and their panels become tabs. The main
 * area is one of these - it "just works like tabs".
 */
export const TAB_REGIONS: DockRegion[] = ['main']
export function isTabRegion(region: DockRegion): boolean {
  return TAB_REGIONS.includes(region)
}

export type PanelGroup = {
  id: string
  panels: PanelId[]
  active: PanelId
  collapsed: boolean
}

export type FloatingGroup = PanelGroup & { rect: PanelRect }

export type PanelLayout = {
  docks: Record<DockRegion, PanelGroup[]>
  floating: FloatingGroup[]
  /**
   * Panels the user has hidden entirely (via a tab's context menu). They stay
   * out of every group - normalization strips them instead of re-adding them
   * at their default placement - until shown again.
   */
  hidden: PanelId[]
}

export type DropTarget =
  /** Join a group as a tab at `index` (Infinity = append). */
  | { kind: 'tabs'; groupId: string; index: number }
  /** Become a new dock group inserted at `index` in `region`. */
  | { kind: 'dock-gap'; region: DockRegion; index: number }
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

function emptyDocks(): Record<DockRegion, PanelGroup[]> {
  return { sidebar: [], main: [], secondary: [] }
}

/** Merge every group of each tab-region into one, so those regions stay single-group. */
function coalesceTabRegions(
  docks: Record<DockRegion, PanelGroup[]>,
): Record<DockRegion, PanelGroup[]> {
  let changed = false
  const result = { ...docks }
  for (const region of TAB_REGIONS) {
    const groups = docks[region]
    if (groups.length <= 1) continue
    changed = true
    result[region] = [
      {
        id: groups[0].id,
        panels: groups.flatMap((g) => g.panels),
        active: groups[0].active,
        collapsed: false,
      },
    ]
  }
  return changed ? result : docks
}

/** A layout with every tab-region collapsed to a single group. */
function coalesceLayout(layout: PanelLayout): PanelLayout {
  const docks = coalesceTabRegions(layout.docks)
  return docks === layout.docks ? layout : { ...layout, docks }
}

/**
 * Reconcile a stored (or live) layout with the registered panels: drop
 * unregistered and duplicate panels, drop empty groups, repair active tabs
 * and rects, then place registered panels the layout does not contain at
 * their default placement. Accepts arbitrary junk for `stored`, and migrates
 * the legacy single-`dock` shape into the `sidebar` region.
 */
export function normalizeLayout(
  stored: unknown,
  definitions: PanelDefinition[],
): PanelLayout {
  const known = new Map(definitions.map((d) => [d.id, d]))
  const seenPanels = new Set<PanelId>()
  const usedIds = new Set<string>()
  const s = stored as {
    docks?: unknown
    dock?: unknown
    floating?: unknown
    hidden?: unknown
  } | null

  // Hidden panels count as seen before the groups are sanitized: any stale
  // group entry drops out, and the default-placement pass skips them - a
  // hidden panel exists nowhere in the layout.
  const hidden: PanelId[] = []
  for (const value of Array.isArray(s?.hidden) ? s.hidden : []) {
    if (typeof value !== 'string' || !known.has(value)) continue
    if (seenPanels.has(value)) continue
    seenPanels.add(value)
    hidden.push(value)
  }

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

  const docks = emptyDocks()
  const storedDocks = s?.docks as Record<string, unknown> | undefined
  for (const region of DOCK_REGIONS) {
    // New shape: docks[region]. Legacy shape: a single `dock` array, migrated
    // into the sidebar so existing arrangements survive the upgrade.
    const source =
      storedDocks && region in storedDocks
        ? storedDocks[region]
        : region === 'sidebar'
          ? s?.dock
          : undefined
    for (const value of Array.isArray(source) ? source : []) {
      const group = sanitizeGroup(value)
      if (group) docks[region].push(group)
    }
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
  // in registration order. Panels placed in this pass that share a dock
  // `group` key become tabs of one group (the first of them stays active).
  const defaultGroups = new Map<string, PanelGroup>()
  for (const definition of definitions) {
    if (seenPanels.has(definition.id)) continue
    const placement = definition.defaultPlacement
    if (placement.kind === 'dock') {
      const key = placement.group
        ? `${placement.region}:${placement.group}`
        : null
      const shared = key ? defaultGroups.get(key) : undefined
      if (shared) {
        shared.panels.push(definition.id)
      } else {
        const group = newGroup(definition.id)
        docks[placement.region].push(group)
        if (key) defaultGroups.set(key, group)
      }
    } else {
      floating.push({
        ...newGroup(definition.id),
        rect: clampToViewport(placement.rect()),
      })
    }
  }

  return coalesceLayout({ docks, floating, hidden })
}

/** Apply a per-group update across every dock region and the floating groups. */
function mapGroups(
  layout: PanelLayout,
  update: <T extends PanelGroup>(g: T) => T,
): PanelLayout {
  const docks = emptyDocks()
  for (const region of DOCK_REGIONS)
    docks[region] = layout.docks[region].map(update)
  return { docks, floating: layout.floating.map(update), hidden: layout.hidden }
}

export function activatePanel(
  layout: PanelLayout,
  groupId: string,
  panel: PanelId,
): PanelLayout {
  return mapGroups(layout, (g) =>
    g.id === groupId && g.panels.includes(panel) ? { ...g, active: panel } : g,
  )
}

export function toggleCollapsed(
  layout: PanelLayout,
  groupId: string,
): PanelLayout {
  return mapGroups(layout, (g) =>
    g.id === groupId ? { ...g, collapsed: !g.collapsed } : g,
  )
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
  let removedRegion: DockRegion | null = null
  let removedDockGroupIndex = -1
  const strip = <T extends PanelGroup>(g: T): T => {
    if (g.id !== fromGroupId) return g
    removedTabIndex = g.panels.indexOf(panel)
    const panels = g.panels.filter((p) => p !== panel)
    return { ...g, panels, active: g.active === panel ? panels[0] : g.active }
  }
  const docks = emptyDocks()
  for (const region of DOCK_REGIONS) {
    docks[region] = layout.docks[region].map(strip).filter((g, i) => {
      if (g.panels.length > 0) return true
      removedRegion = region
      removedDockGroupIndex = i
      return false
    })
  }
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
    const next = {
      docks: emptyDocks(),
      floating: floating.map(insert),
      hidden: layout.hidden,
    }
    for (const region of DOCK_REGIONS)
      next.docks[region] = docks[region].map(insert)
    const landed = [
      ...DOCK_REGIONS.flatMap((region) => next.docks[region]),
      ...next.floating,
    ].some((g) => g.panels.includes(panel))
    // Target vanished (it was the emptied source group) - treat as a no-op.
    return landed ? coalesceLayout(next) : layout
  }

  if (target.kind === 'dock-gap') {
    // `target.index` is a gap in the pre-strip order. A removal earlier in the
    // *same* region shifted later groups up, so adjust first, then clamp to the
    // stripped array (adjusting after clamping would misplace an end drop).
    let index = target.index
    if (
      removedRegion === target.region &&
      removedDockGroupIndex >= 0 &&
      removedDockGroupIndex < index
    )
      index -= 1
    index = Math.min(index, docks[target.region].length)
    docks[target.region].splice(index, 0, newGroup(panel))
    return coalesceLayout({ docks, floating, hidden: layout.hidden })
  }

  // Tear out: keep the size it had when it floated alone, position the tab
  // bar under the pointer, and stack on top.
  const size = sourceRect ?? DEFAULT_FLOAT_SIZE
  const rect = clampToViewport({
    ...size,
    x: pointer.x - 48,
    y: pointer.y - 18,
  })
  return coalesceLayout({
    docks,
    floating: [...floating, { ...newGroup(panel), rect }],
    hidden: layout.hidden,
  })
}

/**
 * Hide `panel` entirely: it leaves whatever group holds it and joins the
 * hidden list, where normalization keeps it from reappearing at its default
 * placement. Re-normalizing against the definitions does the removal (and
 * drops the group if the panel was its last tab).
 */
export function hidePanel(
  layout: PanelLayout,
  panel: PanelId,
  definitions: PanelDefinition[],
): PanelLayout {
  if (layout.hidden.includes(panel)) return layout
  return normalizeLayout(
    { ...layout, hidden: [...layout.hidden, panel] },
    definitions,
  )
}

/**
 * Show a hidden panel again. With `at`, it joins that group as the tab right
 * after `at.after` (append when that tab is gone) and becomes active - the
 * context-menu case, where `at` is the tab the menu was opened from. Without
 * `at`, or when the group no longer exists, normalization places it at its
 * default placement.
 */
export function showPanel(
  layout: PanelLayout,
  panel: PanelId,
  at: { groupId: string; after: PanelId } | null,
  definitions: PanelDefinition[],
): PanelLayout {
  const hidden = layout.hidden.filter((p) => p !== panel)
  if (hidden.length === layout.hidden.length) return layout
  let inserted = false
  const next = mapGroups({ ...layout, hidden }, (g) => {
    if (!at || g.id !== at.groupId || inserted) return g
    inserted = true
    const anchor = g.panels.indexOf(at.after)
    const panels = [...g.panels]
    panels.splice(anchor >= 0 ? anchor + 1 : panels.length, 0, panel)
    // Expand and activate so the shown panel is visible right away.
    return { ...g, panels, active: panel, collapsed: false }
  })
  return inserted ? next : normalizeLayout(next, definitions)
}
