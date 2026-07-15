import * as React from 'react'
import { createPortal } from 'react-dom'

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
const DRAG_THRESHOLD = 5

type PanelsContextValue = {
  layout: PanelLayout
  definitions: Map<PanelId, PanelDefinition>
  drag: TabDrop | null
  onTabPointerDown: (
    e: React.PointerEvent<HTMLElement>,
    groupId: string,
    panel: PanelId,
  ) => void
  toggle: (groupId: string) => void
  toFront: (groupId: string) => void
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
      if (along < BODY_EDGE) return { kind: 'dock-gap', region, index: groupIndex }
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

export function PanelsProvider({ children }: { children: React.ReactNode }) {
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
  const layoutRef = React.useRef(layout)
  layoutRef.current = layout

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
    onTabPointerDown,
    toggle: React.useCallback(
      (groupId) => setLayout((l) => toggleCollapsed(l, groupId)),
      [],
    ),
    toFront: React.useCallback(
      (groupId) => setLayout((l) => bringToFront(l, groupId)),
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
            <FloatingGroupWindow key={group.id} group={group} />
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

/** The docked groups of one region, stacked vertically. */
export function PanelDock({ region }: { region: DockRegion }) {
  const { layout, drag } = usePanels()
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
          Drag panels here
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
 * hides while another main panel (the Media Library) is showing. It keeps its
 * own docked panels mounted across the switch - hidden via CSS, not unmounted -
 * so their state survives, and a display:none dock stays out of drop
 * hit-testing so nothing can be dropped into it while it is hidden.
 */
export function SecondaryDock({
  visibleForMainPanel,
}: {
  visibleForMainPanel?: PanelId
}) {
  const { layout, drag } = usePanels()
  const hasPanels = layout.docks.secondary.length > 0
  // The main area is a tab region, so it coalesces to a single group; its
  // active tab decides whether this contextual dock is showing.
  const hidden =
    visibleForMainPanel !== undefined &&
    layout.docks.main[0]?.active !== visibleForMainPanel
  // Empty and neither worth keeping mounted nor being dropped into: render
  // nothing. (A hidden contextual dock never reveals for a drag.)
  if (!hasPanels && (hidden || !drag)) return null
  return (
    <div
      className={cn(
        'flex w-80 shrink-0 flex-col border-l bg-neutral-900',
        hidden && 'hidden',
      )}
    >
      <PanelDock region="secondary" />
    </div>
  )
}

function FloatingGroupWindow({ group }: { group: FloatingGroup }) {
  const { definitions, toFront, trackFloatingResize } = usePanels()
  const handles = group.collapsed
    ? RESIZE_HANDLES.filter((h) => h.direction === 'e' || h.direction === 'w')
    : RESIZE_HANDLES
  return (
    <div
      role="dialog"
      aria-label={group.panels
        .map((panel) => definitions.get(panel)?.title ?? panel)
        .join(', ')}
      className="fixed z-100 flex flex-col overflow-hidden rounded-lg border rounded-tl-none bg-neutral-900 text-white shadow-lg"
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
  const { definitions, drag, onTabPointerDown, trackFloatingDrag } = usePanels()
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
  const { definitions } = usePanels()
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
            <definition.component />
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
