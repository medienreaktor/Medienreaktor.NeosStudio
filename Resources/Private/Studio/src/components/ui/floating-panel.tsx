import * as React from 'react'
import { createPortal } from 'react-dom'
import { XIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * A free-floating, Adobe-CS-style palette: drag it by its header, resize it
 * from any edge or corner. Position and size persist to localStorage under
 * `storageKey` and are clamped to the viewport on restore and window resize.
 * Renders into a portal above everything else (including the sidebar).
 */

export type PanelRect = { x: number; y: number; width: number; height: number }

const MIN_WIDTH = 280
const MIN_HEIGHT = 240
const VIEWPORT_MARGIN = 8

function clampToViewport(rect: PanelRect): PanelRect {
  const width = Math.min(Math.max(rect.width, MIN_WIDTH), window.innerWidth - VIEWPORT_MARGIN * 2)
  const height = Math.min(Math.max(rect.height, MIN_HEIGHT), window.innerHeight - VIEWPORT_MARGIN * 2)
  return {
    width,
    height,
    x: Math.min(Math.max(rect.x, VIEWPORT_MARGIN), window.innerWidth - width - VIEWPORT_MARGIN),
    y: Math.min(Math.max(rect.y, VIEWPORT_MARGIN), window.innerHeight - height - VIEWPORT_MARGIN),
  }
}

function loadRect(storageKey: string, defaultRect: () => PanelRect): PanelRect {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) ?? '') as Partial<PanelRect>
    if ([stored.x, stored.y, stored.width, stored.height].every((v) => Number.isFinite(v))) {
      return clampToViewport(stored as PanelRect)
    }
  } catch {
    /* no or invalid stored geometry - use the default */
  }
  return clampToViewport(defaultRect())
}

type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

const RESIZE_HANDLES: Array<{ direction: ResizeDirection; className: string }> = [
  { direction: 'n', className: 'inset-x-2 -top-1 h-2 cursor-n-resize' },
  { direction: 's', className: 'inset-x-2 -bottom-1 h-2 cursor-s-resize' },
  { direction: 'e', className: 'inset-y-2 -right-1 w-2 cursor-e-resize' },
  { direction: 'w', className: 'inset-y-2 -left-1 w-2 cursor-w-resize' },
  { direction: 'ne', className: '-top-1 -right-1 size-3 cursor-ne-resize' },
  { direction: 'nw', className: '-top-1 -left-1 size-3 cursor-nw-resize' },
  { direction: 'se', className: '-bottom-1 -right-1 size-3 cursor-se-resize' },
  { direction: 'sw', className: '-bottom-1 -left-1 size-3 cursor-sw-resize' },
]

const FloatingPanelContext = React.createContext<{
  onDragPointerDown: (e: React.PointerEvent<HTMLElement>) => void
  onClose: () => void
} | null>(null)

export function FloatingPanel({
  open,
  onClose,
  storageKey,
  defaultRect,
  className,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  open: boolean
  onClose: () => void
  /** localStorage key the panel's position and size persist under. */
  storageKey: string
  /** Initial geometry when nothing is stored yet; evaluated lazily. */
  defaultRect: () => PanelRect
  'aria-label': string
}) {
  const [rect, setRect] = React.useState<PanelRect | null>(null)
  const rectRef = React.useRef<PanelRect | null>(null)
  rectRef.current = rect
  const [isDragging, setIsDragging] = React.useState(false)

  // Load lazily on open (not at mount) so restored geometry is clamped
  // against the viewport dimensions of that moment.
  React.useEffect(() => {
    if (open) setRect(loadRect(storageKey, defaultRect))
    // defaultRect is intentionally not a dependency - it is only a fallback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, storageKey])

  React.useEffect(() => {
    if (!open) return
    const onWindowResize = () => {
      if (rectRef.current) setRect(clampToViewport(rectRef.current))
    }
    const onKeyDown = (e: KeyboardEvent) => {
      // Dialogs and popups stacked above the panel handle Escape themselves
      // and prevent the default - only a "free" Escape closes the panel.
      if (e.key === 'Escape' && !e.defaultPrevented) onClose()
    }
    window.addEventListener('resize', onWindowResize)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('resize', onWindowResize)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose])

  // Shared pointer-capture loop for dragging and resizing: `update` maps the
  // pointer delta to the next rect, pointer-up persists it.
  const trackPointer = React.useCallback(
    (e: React.PointerEvent<HTMLElement>, update: (start: PanelRect, dx: number, dy: number) => PanelRect) => {
      const start = rectRef.current
      if (!start) return
      e.preventDefault()
      const handle = e.currentTarget
      handle.setPointerCapture(e.pointerId)
      setIsDragging(true)
      const origin = { x: e.clientX, y: e.clientY }
      let current = start
      const onMove = (ev: PointerEvent) => {
        current = update(start, ev.clientX - origin.x, ev.clientY - origin.y)
        setRect(current)
      }
      const onUp = () => {
        setIsDragging(false)
        localStorage.setItem(storageKey, JSON.stringify(current))
        handle.removeEventListener('pointermove', onMove)
        handle.removeEventListener('pointerup', onUp)
      }
      handle.addEventListener('pointermove', onMove)
      handle.addEventListener('pointerup', onUp)
    },
    [storageKey]
  )

  const onDragPointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      // Buttons and other controls inside the header stay clickable.
      if ((e.target as HTMLElement).closest('button, a, input, select, textarea')) return
      trackPointer(e, (start, dx, dy) => clampToViewport({ ...start, x: start.x + dx, y: start.y + dy }))
    },
    [trackPointer]
  )

  const onResizePointerDown = (direction: ResizeDirection) => (e: React.PointerEvent<HTMLElement>) => {
    trackPointer(e, (start, dx, dy) => {
      let { x, y, width, height } = start
      if (direction.includes('e')) width = start.width + dx
      if (direction.includes('s')) height = start.height + dy
      if (direction.includes('w')) width = start.width - dx
      if (direction.includes('n')) height = start.height - dy
      width = Math.min(Math.max(width, MIN_WIDTH), window.innerWidth - VIEWPORT_MARGIN * 2)
      height = Math.min(Math.max(height, MIN_HEIGHT), window.innerHeight - VIEWPORT_MARGIN * 2)
      // Resizing from the west/north edge moves the origin so the opposite
      // edge stays anchored.
      if (direction.includes('w')) x = start.x + start.width - width
      if (direction.includes('n')) y = start.y + start.height - height
      return clampToViewport({ x, y, width, height })
    })
  }

  const context = React.useMemo(() => ({ onDragPointerDown, onClose }), [onDragPointerDown, onClose])

  if (!open || !rect) return null

  return createPortal(
    <FloatingPanelContext.Provider value={context}>
      <div
        role="dialog"
        data-slot="floating-panel"
        className={cn(
          // z above everything, including the sidebar and drawers.
          'fixed z-100 flex flex-col overflow-hidden rounded-lg border bg-card text-card-foreground shadow-lg outline-none',
          isDragging && 'select-none',
          className
        )}
        style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
        {...props}
      >
        {children}
        {RESIZE_HANDLES.map(({ direction, className: handleClassName }) => (
          <div
            key={direction}
            aria-hidden
            className={cn('absolute z-10 touch-none', handleClassName)}
            onPointerDown={onResizePointerDown(direction)}
          />
        ))}
      </div>
    </FloatingPanelContext.Provider>,
    document.body
  )
}

/** The panel's drag handle. Renders a close button after its children. */
export function FloatingPanelHeader({ className, children, ...props }: React.ComponentProps<'div'>) {
  const context = React.useContext(FloatingPanelContext)
  return (
    <div
      data-slot="floating-panel-header"
      className={cn(
        'relative flex cursor-grab touch-none flex-col gap-0.5 border-b p-4 pr-10 active:cursor-grabbing',
        className
      )}
      onPointerDown={context?.onDragPointerDown}
      {...props}
    >
      {children}
      <button
        type="button"
        aria-label="Close"
        className="absolute top-3 right-3 rounded-xs p-1 text-muted-foreground opacity-70 transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        onClick={context?.onClose}
      >
        <XIcon className="size-4" />
      </button>
    </div>
  )
}

export function FloatingPanelTitle({ className, ...props }: React.ComponentProps<'h2'>) {
  return <h2 data-slot="floating-panel-title" className={cn('font-semibold text-foreground', className)} {...props} />
}

export function FloatingPanelDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return <p data-slot="floating-panel-description" className={cn('text-sm text-muted-foreground', className)} {...props} />
}
