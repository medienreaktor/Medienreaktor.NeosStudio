import * as React from 'react'
import { createPortal } from 'react-dom'
import { ChevronDownIcon } from 'lucide-react'

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
  type DropTarget,
  type FloatingGroup,
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

/** Hit-test the pointer against the drop zones in the DOM. */
function findDropTarget(x: number, y: number): DropTarget {
  const zone = document
    .elementFromPoint(x, y)
    ?.closest<HTMLElement>('[data-panel-drop]')
  if (zone?.dataset.panelDrop === 'tabs' && zone.dataset.groupId) {
    // A group's body appends; its tab bar inserts at the pointer's position.
    if ('append' in zone.dataset)
      return { kind: 'tabs', groupId: zone.dataset.groupId, index: Infinity }
    const tabs = Array.from(
      zone.querySelectorAll<HTMLElement>('[data-panel-tab]'),
    )
    const index = tabs.filter((tab) => {
      const r = tab.getBoundingClientRect()
      return r.left + r.width / 2 < x
    }).length
    return { kind: 'tabs', groupId: zone.dataset.groupId, index }
  }
  if (zone?.dataset.panelDrop === 'dock') {
    const groups = Array.from(
      zone.querySelectorAll<HTMLElement>('[data-panel-group]'),
    )
    const index = groups.filter((group) => {
      const r = group.getBoundingClientRect()
      return r.top + r.height / 2 < y
    }).length
    return { kind: 'dock-gap', index }
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

/** The docked groups, stacked vertically. Render inside the sidebar. */
export function PanelDock() {
  const { layout, drag } = usePanels()
  const gapIndex = drag?.target.kind === 'dock-gap' ? drag.target.index : null
  return (
    <div
      data-panel-drop="dock"
      className="flex min-h-0 flex-1 flex-col gap-2 p-2"
    >
      {layout.dock.map((group, index) => (
        <React.Fragment key={group.id}>
          {gapIndex === index && <DockGapMarker />}
          <div
            data-panel-group
            className={cn(
              'flex min-h-0 flex-col overflow-hidden bg-card text-card-foreground',
              !group.collapsed && 'flex-1',
            )}
          >
            <GroupTabBar group={group} />
            <GroupBody group={group} collapsed={group.collapsed} />
          </div>
        </React.Fragment>
      ))}
      {gapIndex !== null && gapIndex >= layout.dock.length && <DockGapMarker />}
      {layout.dock.length === 0 && (
        <div className="grid flex-1 place-items-center text-xs text-muted-foreground">
          Drag panels here
        </div>
      )}
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
      className="fixed z-100 flex flex-col overflow-hidden rounded-lg border rounded-tl-none bg-card text-card-foreground shadow-lg"
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
  const { definitions, drag, onTabPointerDown, toggle, trackFloatingDrag } =
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
        dropIndex !== null && 'bg-accent/40',
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
                ? 'bg-background text-accent-foreground border-primary'
                : 'text-muted-foreground hover:text-foreground border-transparent',
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
      <button
        type="button"
        aria-label={
          group.collapsed ? 'Expand panel group' : 'Collapse panel group'
        }
        onClick={() => toggle(group.id)}
        className="p-1 text-muted-foreground hover:text-foreground"
      >
        <ChevronDownIcon
          className={cn(
            'size-3.5 transition-transform',
            group.collapsed && '-rotate-90',
          )}
        />
      </button>
    </div>
  )
}

function GroupBody({
  group,
  collapsed = false,
}: {
  group: PanelGroup
  collapsed?: boolean
}) {
  const { definitions } = usePanels()
  return (
    // The body doubles as a drop zone that appends to this group's tabs.
    // Collapsed groups keep the body mounted (hidden) so every panel's
    // component - and its state - survives a collapse, just like tab switches.
    <div
      data-panel-drop="tabs"
      data-group-id={group.id}
      data-append
      className={cn(
        'flex min-h-0 flex-1 flex-col bg-background',
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
      className="pointer-events-none fixed z-120 rounded-md border bg-card px-2 py-1 text-xs shadow-md"
      style={{ left: drag.pointer.x + 12, top: drag.pointer.y + 12 }}
    >
      {title}
    </div>
  )
}

// Negative margins cancel the marker's own footprint (its box plus the extra
// flex gap), so showing it does not shift the layout being hit-tested.
const TabDropMarker = () => (
  <div className="-mx-0.25 h-5 w-0.5 shrink-0 rounded bg-primary" />
)
const DockGapMarker = () => (
  <div className="-my-1.25 h-0.5 shrink-0 rounded bg-primary" />
)
