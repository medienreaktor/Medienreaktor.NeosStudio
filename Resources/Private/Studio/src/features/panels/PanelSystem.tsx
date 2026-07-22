import * as React from 'react'
import { createPortal } from 'react-dom'

import { translate as t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import {
  clampToViewport,
  RESIZE_HANDLES,
  type PanelRect,
  type ResizeDirection,
  resizeRect,
} from './geometry'
import {
  activatePanel,
  applyDrop,
  bringToFront,
  clampFloating,
  type DockRegion,
  DOCK_REGIONS,
  type DropTarget,
  type FloatingGroup,
  isTabRegion,
  loadLayout,
  normalizeLayout,
  type PanelGroup,
  type PanelId,
  type PanelLayout,
  saveLayout,
  setFloatingRect,
  type TabDrop,
  toggleCollapsed,
} from './panelLayout'
import { type PanelDefinition, panelRegistry } from './registry'

/**
 * Adobe-CS-style dockable panels: every panel registered in the panelRegistry
 * is a tab in a group; groups stack in the sidebar dock or float above the
 * app. Drag a tab to reorder it, merge it into another group (drop on a tab
 * bar or a group's body), dock it between groups (drop in a sidebar gap), or
 * tear it out (drop anywhere else). Floating groups drag by their bar, resize
 * from every edge, collapse to their tab bar and stack by click order. The
 * layout persists to localStorage.
 *
 * Wrap the app in <PanelsProvider> (it portals the floating groups and the
 * drag ghost to <body>) and render <PanelDock /> where docked groups belong.
 */

const STORAGE_KEY = 'neos-studio.panel_layout'
const SECONDARY_COLLAPSED_KEY = 'neos-studio.secondary_collapsed'
const DRAG_THRESHOLD = 5

/** A boolean flag persisted to localStorage under `key`. */
function usePersistedFlag(
  key: string,
): [boolean, React.Dispatch<React.SetStateAction<boolean>>] {
  const [value, setValue] = React.useState(
    () => localStorage.getItem(key) === 'true',
  )
  React.useEffect(() => {
    localStorage.setItem(key, String(value))
  }, [key, value])
  return [value, setValue]
}

type PanelsContextValue = {
  layout: PanelLayout
  definitions: Map<PanelId, PanelDefinition>
  drag: TabDrop | null
  /** Panels currently requesting attention (see useRequestAttention). */
  attention: ReadonlySet<PanelId>
  /** Toggle a panel's attention request; called by useRequestAttention. */
  setPanelAttention: (panel: PanelId, active: boolean) => void
  onTabPointerDown: (
    e: React.PointerEvent<HTMLElement>,
    groupId: string,
    panel: PanelId,
  ) => void
  toggle: (groupId: string) => void
  toFront: (groupId: string) => void
  /** Make `panel` the active tab of whichever group holds it, wherever it is docked or floating. */
  activate: (panel: PanelId) => void
  trackFloatingDrag: (
    e: React.PointerEvent<HTMLElement>,
    groupId: string,
  ) => void
  trackFloatingResize: (
    e: React.PointerEvent<HTMLElement>,
    groupId: string,
    direction: ResizeDirection,
  ) => void
}

const PanelsContext = React.createContext<PanelsContextValue | null>(null)

function usePanels(): PanelsContextValue {
  const context = React.useContext(PanelsContext)
  if (!context)
    throw new Error('Panel components must live inside <PanelsProvider>')
  return context
}

/**
 * The id of the panel a component is rendered as. GroupBody provides it around
 * each panel's component so the panel can identify itself to the panel system
 * (e.g. request attention) without being handed props.
 */
const PanelIdContext = React.createContext<PanelId | null>(null)

/**
 * Let a panel flag that it needs the user's attention while `active` is true:
 * the panel system draws a blue ring around its group, tints its tab, and dims
 * every other panel so the eye lands on this one. Use it for a panel that has
 * momentarily taken over a task the user must finish - the Media Library in
 * asset-picker mode, say. The flag clears when `active` goes false or the panel
 * unmounts. A no-op outside a panel body (no PanelIdContext).
 */
export function useRequestAttention(active: boolean): void {
  const panel = React.useContext(PanelIdContext)
  const { setPanelAttention } = usePanels()
  React.useEffect(() => {
    if (!panel || !active) return
    setPanelAttention(panel, true)
    return () => setPanelAttention(panel, false)
  }, [panel, active, setPanelAttention])
}

/**
 * The public handle for programmatically switching panels - the seed of a
 * plugin API for panels that hand off to one another (an inspector editor that
 * jumps to the Media Library to pick an asset, say). `activate` focuses a panel
 * wherever it lives; `activeMainPanel` is the main area's current tab, so a
 * caller can restore it after the hand-off.
 */
export function usePanelSwitcher(): {
  activate: (panel: PanelId) => void
  activeMainPanel: PanelId | null
} {
  const { activate, layout } = usePanels()
  return { activate, activeMainPanel: layout.docks.main[0]?.active ?? null }
}

/**
 * How each dock region arranges its groups: the sidebars stack vertically, the
 * main area lays its groups side by side (Visual Editor left, Media Library
 * right by default). This drives both the flex direction and which axis the
 * drop-gap hit-testing measures.
 */
const REGION_ORIENTATION: Record<DockRegion, 'horizontal' | 'vertical'> = {
  sidebar: 'vertical',
  // The main area is a single tab group, so its orientation is moot; the
  // sidebars stack their groups vertically.
  main: 'vertical',
  secondary: 'vertical',
}

/** The index of the group containing `el` among its region's docked groups. */
function indexOfGroup(el: HTMLElement): number | null {
  const groupEl = el.closest<HTMLElement>('[data-panel-group]')
  const regionEl = groupEl?.parentElement ?? null
  if (!groupEl || !regionEl) return null
  const groups = Array.from(
    regionEl.querySelectorAll<HTMLElement>(':scope > [data-panel-group]'),
  )
  return groups.indexOf(groupEl)
}

/** Portion of a group's body along the axis that docks a new group vs. tabs in. */
const BODY_EDGE = 0.25

/** Hit-test the pointer against the drop zones in the DOM. */
function findDropTarget(x: number, y: number): DropTarget {
  const zone = document
    .elementFromPoint(x, y)
    ?.closest<HTMLElement>('[data-panel-drop]')
  const kind = zone?.dataset.panelDrop

  // A tab bar: join the group as a tab at the pointer's position. This is the
  // only way to merge a panel in as a tab now that bodies are inert.
  if (kind === 'tabs' && zone?.dataset.groupId) {
    const tabs = Array.from(
      zone.querySelectorAll<HTMLElement>('[data-panel-tab]'),
    )
    const index = tabs.filter((tab) => {
      const r = tab.getBoundingClientRect()
      return r.left + r.width / 2 < x
    }).length
    return { kind: 'tabs', groupId: zone.dataset.groupId, index }
  }

  // A docked group's body in a stacking region: only its leading/trailing edge
  // is a drop zone - it docks a new group before/after (i.e. above/below). The
  // wide middle is deliberately inert so it falls through to a float (tear-out),
  // and merging as a tab is done on the tab bar. (Tab regions and floating
  // groups render an inert 'none' body, so their whole body falls through too.)
  if (kind === 'body' && zone?.dataset.region) {
    const region = zone.dataset.region as DockRegion
    const groupIndex = indexOfGroup(zone)
    if (groupIndex !== null) {
      const horizontal = REGION_ORIENTATION[region] === 'horizontal'
      const r = zone.getBoundingClientRect()
      const along = horizontal ? (x - r.left) / r.width : (y - r.top) / r.height
      if (along < BODY_EDGE)
        return { kind: 'dock-gap', region, index: groupIndex }
      if (along > 1 - BODY_EDGE)
        return { kind: 'dock-gap', region, index: groupIndex + 1 }
    }
    return { kind: 'float' }
  }

  // A region's own area - the gaps between slots, an empty region, or a
  // tabbar-region tab bar (whose drops route here): dock a new group at the
  // pointer's position along the region's axis.
  if (kind === 'dock' && zone?.dataset.region) {
    const region = zone.dataset.region as DockRegion
    const horizontal = REGION_ORIENTATION[region] === 'horizontal'
    const groups = Array.from(
      zone.querySelectorAll<HTMLElement>('[data-panel-group]'),
    )
    const index = groups.filter((group) => {
      const r = group.getBoundingClientRect()
      // Count the groups the pointer sits past, along the region's axis.
      return horizontal ? r.left + r.width / 2 < x : r.top + r.height / 2 < y
    }).length
    return { kind: 'dock-gap', region, index }
  }
  return { kind: 'float' }
}

export function PanelsProvider({
  children,
  floatingVisibleForMainPanel,
}: {
  children: React.ReactNode
  /**
   * When set, floating groups are contextual to the main area's active tab -
   * same as SecondaryDock's `visibleForMainPanel`: they show only while this
   * panel (the Visual Editor) is the active main tab, and hide (via CSS, so
   * their state survives and they stay out of drop hit-testing) otherwise.
   */
  floatingVisibleForMainPanel?: PanelId
}) {
  const registered = React.useSyncExternalStore(
    (onChange) => panelRegistry.subscribe(onChange),
    () => panelRegistry.getAll(),
  )
  const definitions = React.useMemo(
    () => new Map(registered.map((d) => [d.id, d])),
    [registered],
  )
  const [layout, setLayout] = React.useState<PanelLayout>(() =>
    loadLayout(STORAGE_KEY, panelRegistry.getAll()),
  )
  const [drag, setDrag] = React.useState<TabDrop | null>(null)
  const [attention, setAttention] = React.useState<ReadonlySet<PanelId>>(
    () => new Set(),
  )
  const layoutRef = React.useRef(layout)
  layoutRef.current = layout

  const setPanelAttention = React.useCallback(
    (panel: PanelId, active: boolean) => {
      setAttention((prev) => {
        if (active === prev.has(panel)) return prev
        const next = new Set(prev)
        if (active) next.add(panel)
        else next.delete(panel)
        return next
      })
    },
    [],
  )

  // Panels registered or unregistered after mount (plugins): reconcile the
  // layout - new panels appear at their default placement, unloaded panels'
  // entries drop out.
  React.useEffect(() => {
    setLayout((l) => normalizeLayout(l, registered))
  }, [registered])

  // Persist debounced (drags update the rect per pointermove); flush on
  // unload so the very last change survives a quick tab close.
  React.useEffect(() => {
    const timeout = setTimeout(() => saveLayout(STORAGE_KEY, layout), 300)
    return () => clearTimeout(timeout)
  }, [layout])
  React.useEffect(() => {
    const flush = () => saveLayout(STORAGE_KEY, layoutRef.current)
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [])

  React.useEffect(() => {
    const onWindowResize = () => setLayout((l) => clampFloating(l))
    window.addEventListener('resize', onWindowResize)
    return () => window.removeEventListener('resize', onWindowResize)
  }, [])

  // Floating groups are hidden while the main area shows a tab other than the
  // one they belong to (the main region coalesces to a single group, so its
  // active tab decides). Kept mounted-but-hidden so their state survives.
  const floatingHidden =
    floatingVisibleForMainPanel !== undefined &&
    layout.docks.main[0]?.active !== floatingVisibleForMainPanel

  const isDragging = drag !== null
  React.useEffect(() => {
    if (!isDragging) return
    const previous = document.body.style.cursor
    document.body.style.cursor = 'grabbing'
    return () => {
      document.body.style.cursor = previous
    }
  }, [isDragging])

  const onTabPointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLElement>, groupId: string, panel: PanelId) => {
      if (e.button !== 0) return
      // Adobe-style: pointerdown already activates the tab; a drag may follow.
      setLayout((l) => activatePanel(l, groupId, panel))
      e.preventDefault()
      const handle = e.currentTarget
      handle.setPointerCapture(e.pointerId)
      const startX = e.clientX
      const startY = e.clientY
      const sourceGroup = layoutRef.current.floating.find(
        (g) => g.id === groupId,
      )
      const sourceRect =
        sourceGroup && sourceGroup.panels.length === 1 ? sourceGroup.rect : null
      let current: TabDrop | null = null
      const onMove = (ev: PointerEvent) => {
        if (
          !current &&
          Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD
        )
          return
        current = {
          panel,
          fromGroupId: groupId,
          pointer: { x: ev.clientX, y: ev.clientY },
          target: findDropTarget(ev.clientX, ev.clientY),
          sourceRect,
        }
        setDrag(current)
      }
      const onUp = () => {
        handle.removeEventListener('pointermove', onMove)
        handle.removeEventListener('pointerup', onUp)
        setDrag(null)
        if (current) setLayout((l) => applyDrop(l, current!))
      }
      handle.addEventListener('pointermove', onMove)
      handle.addEventListener('pointerup', onUp)
    },
    [],
  )

  // Shared pointer-capture loop for moving/resizing floating groups.
  const trackFloating = React.useCallback(
    (
      e: React.PointerEvent<HTMLElement>,
      groupId: string,
      update: (start: PanelRect, dx: number, dy: number) => PanelRect,
    ) => {
      if (e.button !== 0) return
      const group = layoutRef.current.floating.find((g) => g.id === groupId)
      if (!group) return
      e.preventDefault()
      const handle = e.currentTarget
      handle.setPointerCapture(e.pointerId)
      const start = group.rect
      const startX = e.clientX
      const startY = e.clientY
      const onMove = (ev: PointerEvent) => {
        const rect = update(start, ev.clientX - startX, ev.clientY - startY)
        setLayout((l) => setFloatingRect(l, groupId, rect))
      }
      const onUp = () => {
        handle.removeEventListener('pointermove', onMove)
        handle.removeEventListener('pointerup', onUp)
      }
      handle.addEventListener('pointermove', onMove)
      handle.addEventListener('pointerup', onUp)
    },
    [],
  )

  const context: PanelsContextValue = {
    layout,
    definitions,
    drag,
    attention,
    setPanelAttention,
    onTabPointerDown,
    toggle: React.useCallback(
      (groupId) => setLayout((l) => toggleCollapsed(l, groupId)),
      [],
    ),
    toFront: React.useCallback(
      (groupId) => setLayout((l) => bringToFront(l, groupId)),
      [],
    ),
    activate: React.useCallback(
      (panel) =>
        setLayout((l) => {
          for (const region of DOCK_REGIONS) {
            const group = l.docks[region].find((g) => g.panels.includes(panel))
            if (group) return activatePanel(l, group.id, panel)
          }
          const floating = l.floating.find((g) => g.panels.includes(panel))
          return floating ? activatePanel(l, floating.id, panel) : l
        }),
      [],
    ),
    trackFloatingDrag: React.useCallback(
      (e, groupId) =>
        trackFloating(e, groupId, (start, dx, dy) =>
          clampToViewport({ ...start, x: start.x + dx, y: start.y + dy }),
        ),
      [trackFloating],
    ),
    trackFloatingResize: React.useCallback(
      (e, groupId, direction) =>
        trackFloating(e, groupId, (start, dx, dy) =>
          resizeRect(start, direction, dx, dy),
        ),
      [trackFloating],
    ),
  }

  return (
    <PanelsContext.Provider value={context}>
      {children}
      {createPortal(
        <>
          {layout.floating.map((group) => (
            <FloatingGroupWindow
              key={group.id}
              group={group}
              hidden={floatingHidden}
            />
          ))}
          {drag && (
            <DragGhost
              drag={drag}
              title={definitions.get(drag.panel)?.title ?? drag.panel}
            />
          )}
        </>,
        document.body,
      )}
    </PanelsContext.Provider>
  )
}

/** Whether this group holds a panel currently requesting attention. */
function groupNeedsAttention(
  group: PanelGroup,
  attention: ReadonlySet<PanelId>,
): boolean {
  return group.panels.some((panel) => attention.has(panel))
}

/**
 * How a group's outer frame reacts to an attention request somewhere in the
 * app: every group that is *not* the one asking dims, so the eye lands on the
 * one that is. The blue border itself goes on the asking group's body (its tab
 * content), not here - see GroupBody. Empty when nothing is asking, so the
 * normal look is untouched.
 */
function attentionDimClasses(
  group: PanelGroup,
  attention: ReadonlySet<PanelId>,
): string {
  if (attention.size === 0 || groupNeedsAttention(group, attention)) return ''
  return 'opacity-20 transition-opacity duration-200'
}

/** The docked groups of one region, stacked vertically. */
export function PanelDock({ region }: { region: DockRegion }) {
  const { layout, drag, attention } = usePanels()
  const gapIndex =
    drag?.target.kind === 'dock-gap' && drag.target.region === region
      ? drag.target.index
      : null
  const groups = layout.docks[region]
  const horizontal = REGION_ORIENTATION[region] === 'horizontal'
  return (
    <div
      data-panel-drop="dock"
      data-region={region}
      className={cn(
        'flex min-h-0 min-w-0 flex-1 gap-2',
        horizontal ? 'flex-row' : 'flex-col',
      )}
    >
      {groups.map((group, index) => (
        <React.Fragment key={group.id}>
          {gapIndex === index && <DockGapMarker horizontal={horizontal} />}
          <div
            data-panel-group
            className={cn(
              'flex min-h-0 min-w-0 flex-col overflow-hidden bg-neutral-900 text-white',
              !group.collapsed && 'flex-1',
              attentionDimClasses(group, attention),
            )}
          >
            <GroupTabBar group={group} />
            <GroupBody
              group={group}
              collapsed={group.collapsed}
              region={region}
            />
          </div>
        </React.Fragment>
      ))}
      {gapIndex !== null && gapIndex >= groups.length && (
        <DockGapMarker horizontal={horizontal} />
      )}
      {groups.length === 0 && (
        <div
          data-panel-drop="dock"
          data-region={region}
          className="grid flex-1 place-items-center text-xs text-neutral-400"
        >
          {t('panel.dragHere', 'Drag panels here')}
        </div>
      )}
    </div>
  )
}

/**
 * The optional right-hand sidebar. It stays hidden (so the main area is full
 * width) until it holds panels, and is revealed while a drag is in progress so
 * a panel can be dropped into it even when empty.
 *
 * Pass `visibleForMainPanel` to make it contextual to the main area's active
 * tab: the dock then belongs to that one main panel (the Visual Editor) and
 * auto-collapses while another main panel (the Media Library) is showing. The
 * user can still expand it there, but that expansion is transient - the
 * persisted collapse preference belongs to the home panel and is restored when
 * the user returns to it. Docked panels stay mounted across the switch (hidden
 * via CSS, not unmounted) so their state survives.
 */
export function SecondaryDock({
  visibleForMainPanel,
}: {
  visibleForMainPanel?: PanelId
}) {
  const { layout, drag } = usePanels()
  const [preferredCollapsed, setPreferredCollapsed] = usePersistedFlag(
    SECONDARY_COLLAPSED_KEY,
  )
  const hasPanels = layout.docks.secondary.length > 0
  // The main area is a tab region, so it coalesces to a single group; its
  // active tab decides whether this contextual dock is in its home context.
  const activeMain = layout.docks.main[0]?.active ?? null
  const away =
    visibleForMainPanel !== undefined && activeMain !== visibleForMainPanel
  const [awayExpandedFor, setAwayExpandedFor] = React.useState<PanelId | null>(
    null,
  )
  const collapsed = away ? awayExpandedFor !== activeMain : preferredCollapsed
  const setCollapsed = (next: boolean) => {
    if (away) setAwayExpandedFor(next ? null : activeMain)
    else setPreferredCollapsed(next)
  }
  // Empty and neither worth keeping mounted nor being dropped into: render
  // nothing.
  if (!hasPanels && !drag) return null
  // A drag in progress force-expands so a panel can be dropped in even when the
  // user has collapsed the region. Collapsing is only offered once it holds
  // panels - an empty dock only ever shows to receive a drop.
  const showCollapsed = collapsed && hasPanels && !drag
  return (
    <div
      className={cn(
        'relative flex shrink-0 flex-col bg-neutral-900',
        // Collapsed: take no width and drop the border so no bar shows - only
        // the expand button, overlaid on the top-right of the main region.
        showCollapsed ? 'w-0' : 'w-80 border-l',
      )}
    >
      {showCollapsed ? (
        <button
          type="button"
          aria-label={t('panel.expand', 'Expand panel')}
          onClick={() => setCollapsed(false)}
          className="absolute top-0 right-0 z-10 grid w-8 h-6 place-items-center text-neutral-400 hover:text-white"
        >
          <i className="fas fa-angles-left text-[1rem]" aria-hidden />
        </button>
      ) : (
        <>
          <PanelDock region="secondary" />
          {/* Overlaid on the tab bar's spare area (top-right) so the tabs still
            start at the very top instead of being pushed down by a header. */}
          {hasPanels && (
            <button
              type="button"
              aria-label={t('panel.collapse', 'Collapse panel')}
              onClick={() => setCollapsed(true)}
              className="absolute top-0 right-0 z-10 grid w-8 h-6 place-items-center text-neutral-400 hover:text-white"
            >
              <i className="fas fa-angles-right text-[1rem]" aria-hidden />
            </button>
          )}
        </>
      )}
    </div>
  )
}

function FloatingGroupWindow({
  group,
  hidden = false,
}: {
  group: FloatingGroup
  hidden?: boolean
}) {
  const { definitions, attention, toFront, trackFloatingResize } = usePanels()
  const handles = group.collapsed
    ? RESIZE_HANDLES.filter((h) => h.direction === 'e' || h.direction === 'w')
    : RESIZE_HANDLES
  return (
    <div
      role="dialog"
      aria-label={group.panels
        .map((panel) => definitions.get(panel)?.title ?? panel)
        .join(', ')}
      className={cn(
        'fixed z-100 flex flex-col overflow-hidden rounded-lg border rounded-tl-none bg-neutral-900 text-white shadow-lg',
        hidden && 'hidden',
        attentionDimClasses(group, attention),
      )}
      style={{
        left: group.rect.x,
        top: group.rect.y,
        width: group.rect.width,
        height: group.collapsed ? undefined : group.rect.height,
      }}
      onPointerDownCapture={() => toFront(group.id)}
    >
      <GroupTabBar group={group} floating />
      <GroupBody group={group} collapsed={group.collapsed} />
      {handles.map(({ direction, className }) => (
        <div
          key={direction}
          aria-hidden
          className={cn('absolute z-10 touch-none', className)}
          onPointerDown={(e) => trackFloatingResize(e, group.id, direction)}
        />
      ))}
    </div>
  )
}

function GroupTabBar({
  group,
  floating = false,
}: {
  group: PanelGroup
  floating?: boolean
}) {
  const { definitions, drag, attention, onTabPointerDown, trackFloatingDrag } =
    usePanels()
  const dropIndex =
    drag?.target.kind === 'tabs' && drag.target.groupId === group.id
      ? Math.min(drag.target.index, group.panels.length)
      : null
  return (
    <div
      data-panel-drop="tabs"
      data-group-id={group.id}
      className={cn(
        // The border stays in the layout when collapsed (only its color goes)
        // so the centered tabs don't shift by the border width on toggle.
        'flex shrink-0 items-center',
        group.collapsed && 'border-b-transparent',
        dropIndex !== null && 'bg-neutral-800/40',
      )}
    >
      {group.panels.map((panel, index) => (
        <React.Fragment key={panel}>
          {dropIndex === index && <TabDropMarker />}
          <button
            type="button"
            data-panel-tab
            onPointerDown={(e) => onTabPointerDown(e, group.id, panel)}
            className={cn(
              'cursor-grab touch-none px-2 py-1 text-xs font-medium select-none border-t',
              panel === group.active
                ? 'bg-neutral-950 text-white border-blue-500'
                : 'text-neutral-400 hover:text-white border-transparent',
              // A panel asking for attention gets a solid blue tab so it reads
              // as the place to look, whether or not it is the active tab.
              attention.has(panel) &&
                'bg-blue-500 text-white border-blue-500 hover:text-white',
              drag?.panel === panel && 'opacity-50',
            )}
          >
            {definitions.get(panel)?.title ?? panel}
          </button>
        </React.Fragment>
      ))}
      {dropIndex !== null && dropIndex >= group.panels.length && (
        <TabDropMarker />
      )}
      {/* The spare bar area drags the whole floating group, Adobe-style. */}
      <div
        className={cn(
          'h-full min-w-4 flex-1',
          floating && 'cursor-grab touch-none',
        )}
        onPointerDown={
          floating ? (e) => trackFloatingDrag(e, group.id) : undefined
        }
      />
    </div>
  )
}

function GroupBody({
  group,
  collapsed = false,
  region,
}: {
  group: PanelGroup
  collapsed?: boolean
  /**
   * The docked region this group sits in, if any. In a stacking region the
   * body is a 'body' drop zone whose edges dock a new stacked group above/below
   * (its wide middle stays inert and falls through to a float). Floating groups
   * and tab regions (the main area) render an inert 'none' body, so their whole
   * body falls through - merging into them is done on their tab bar instead.
   */
  region?: DockRegion
}) {
  const { definitions, attention } = usePanels()
  const stacking = region !== undefined && !isTabRegion(region)
  return (
    // The body doubles as a drop zone. Collapsed groups keep the body mounted
    // (hidden) so every panel's component - and its state - survives a
    // collapse, like tab switches.
    <div
      data-panel-drop={stacking ? 'body' : 'none'}
      data-region={stacking ? region : undefined}
      data-group-id={group.id}
      className={cn(
        'flex min-h-0 flex-1 flex-col bg-neutral-950',
        collapsed && 'hidden',
        // A panel asking for attention frames its content (not the tab bar) in
        // blue, tying together with its blue tab above.
        groupNeedsAttention(group, attention) && 'border-2 border-blue-500',
      )}
    >
      {group.panels.map((panel) => {
        // Unregistered ids only exist for the render before the layout
        // reconciles with the registry - skip them.
        const definition = definitions.get(panel)
        if (!definition) return null
        return (
          // Inactive tabs stay mounted (hidden) so e.g. tree expansion state
          // survives tab switches.
          <div
            key={panel}
            className={cn(
              'min-h-0 flex-1 overflow-y-auto',
              panel !== group.active && 'hidden',
            )}
          >
            <PanelIdContext.Provider value={panel}>
              <definition.component />
            </PanelIdContext.Provider>
          </div>
        )
      })}
    </div>
  )
}

function DragGhost({ drag, title }: { drag: TabDrop; title: string }) {
  return (
    <div
      className="pointer-events-none fixed z-120 rounded-md border bg-neutral-900 px-2 py-1 text-xs shadow-md"
      style={{ left: drag.pointer.x + 12, top: drag.pointer.y + 12 }}
    >
      {title}
    </div>
  )
}

// Negative margins cancel the marker's own footprint (its box plus the extra
// flex gap), so showing it does not shift the layout being hit-tested.
const TabDropMarker = () => (
  <div className="-mx-0.25 h-5 w-0.5 shrink-0 rounded bg-blue-500" />
)
const DockGapMarker = ({ horizontal = false }: { horizontal?: boolean }) =>
  horizontal ? (
    <div className="-mx-1.25 w-0.5 shrink-0 self-stretch rounded bg-blue-500" />
  ) : (
    <div className="-my-1.25 h-0.5 shrink-0 rounded bg-blue-500" />
  )
